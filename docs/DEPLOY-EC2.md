# Deploy on EC2 with Docker and the Wickr IO console

Use this path for development, first bring-up, and quick iteration. You run the stock Wickr IO
container on an EC2 host, attach to its interactive console, and import the bot as an
integration. The console prompts for configuration values and launches the bot for you.

Complete [PREREQUISITES.md](PREREQUISITES.md) first, with one exception noted below.

For production, use ECS Fargate instead:
[DEPLOY-CDK-CODEBUILD.md](DEPLOY-CDK-CODEBUILD.md) (image built in AWS) or
[DEPLOY-CDK-LOCAL-DOCKER.md](DEPLOY-CDK-LOCAL-DOCKER.md) (image built locally).

## How this differs from the ECS paths

| | EC2 console | ECS Fargate |
|---|---|---|
| Container image | Stock Wickr IO image, unmodified | This repo's `Dockerfile`, bot baked in |
| Bot code delivery | `software.tar.gz` imported at the console | Staged into the image at build time |
| Configuration | Console prompts, written to `processes.json` | Container environment variables from the CDK stack |
| Bot credentials | Typed at the console | Secrets Manager, read by the entrypoint |
| What launches the bot | `bot/start.sh`, run by WickrIOSvr | `start-bot.sh` entrypoint |
| AWS credentials | EC2 instance profile via IMDS | ECS task role |

Two consequences worth internalizing. You do **not** build or push a container image on this
path, so no ECR repository and no CodeBuild project are needed — skip those parts of the
prerequisites. And because the console types credentials interactively, no Secrets Manager
secret is required either, though one does no harm.

## Requirements

- An EC2 instance with Docker installed and an **instance profile** granting the bot what it
  needs: Amazon Bedrock `bedrock:InvokeModel` on your model and inference-profile ARNs, `s3:PutObject` on the
  reports bucket, and the Amazon Transcribe actions if you want voice memos.
- Outbound TCP 443 to AWS Wickr. There is no VPC endpoint for Wickr; this is ordinary internet
  egress and the bot cannot function without it.
- A Wickr bot account that is a **room moderator** in every room where it should respond.
- Enough disk for the base image, roughly 3 GB.

### How the bot gets AWS credentials

Two mechanisms work, and the one you pick changes the `docker run` in step 2. Both were verified
on a real EC2 instance on 2026-08-21 against the commercial base image. Note first that neither
is exercised by console import or by Wickr login: a client reporting `Running` tells you nothing
about whether credentials work. The first symptom of getting this wrong is a user submitting a
report and extraction failing.

**Instance profile via IMDS.** The better option on EC2 and what the rest of this guide assumes:
nothing to mount and no credentials on disk. Requires the hop-limit change below, which is the
single most common reason this path appears broken.

**Mounted credentials file.** Add `-v /home/<host-user>/.aws:/home/wickriouser/.aws` to the
`docker run`. Use it when the host authenticates with a credentials file rather than a role.
This works with IMDS still unreachable, so it is a genuine alternative and not a fallback. Two
conditions apply:

- The container path must be `/home/wickriouser/.aws`. That is where the bot looks, because the
  `WickrIOSvr` process runs as `wickriouser` with `HOME=/home/wickriouser`.
- The file must be readable by uid 1000 inside the container. A normal `0600` file in the home
  directory of `ubuntu` or `ec2-user` qualifies, since those are also uid 1000. A `0600` file
  owned by `root` does not, and fails exactly like absent credentials.

The mount does nothing at all on a host that uses only an instance profile: there is no
`~/.aws/credentials` for it to expose, the SDK falls through to IMDS, and the hop limit still
governs. The published AWS sample offers the mount and the instance profile as if they were
interchangeable, which is where that confusion comes from.

#### IMDS hop limit — set this before you start

The bot gets AWS credentials from the instance profile through the instance metadata service.
Inside a bridge-networked Docker container that requires `HttpPutResponseHopLimit=2`. With the
default of 1, the IMDSv2 token response has TTL 1, returning through Docker's bridge consumes
that hop, and the response never reaches the container: the PUT gets no reply and every
subsequent GET is 401. The bot then fails every Bedrock and S3 call with a credentials error
that looks nothing like a networking problem.

```bash
aws ec2 modify-instance-metadata-options --instance-id <instance-id> \
  --http-put-response-hop-limit 2 --http-tokens required --http-endpoint enabled
```

Verify from inside the container once it is running, checking the **status code** rather than
the output:

```bash
docker exec wickrio-console bash -lc \
  'curl -s -o /tmp/t -w "%{http_code}\n" -X PUT http://169.254.169.254/latest/api/token \
   -H "X-aws-ec2-metadata-token-ttl-seconds: 60" --max-time 5'
```

`200` means credentials will work. `000` means the hop limit is still too low.

---

## 1. Build the integration tarball

**Build on Linux or macOS.** The archive must carry the execute bit on the bot's shell scripts;
a tarball built on native Windows does not, and the console then declines to run `install.sh`
and `start.sh` with no useful error.

Cloning on the build host is the reliable way to get this right — the repository's
`.gitattributes` forces LF on `*.sh`, and the scripts are committed mode `100755`, so a fresh
clone produces correct modes and line endings without any manual fixing.

```bash
git clone --branch <branch> <repo-url> wickr-forms-bot
cd wickr-forms-bot

chmod 755 bot/*.sh
tar -czf software.tar.gz --owner=0 --group=0 \
  --exclude=node_modules --exclude=test --exclude=package-lock.json -C bot .
```

Verify before going further:

```bash
tar -tvzf software.tar.gz | grep -e 'sh$'
```

Every `.sh` must read `-rwxr-xr-x root/root`. Note the `-e` — without it `grep` treats the
leading `-rwxr-xr-x` in its own output as options and fails with `invalid option -- '-'`.

The archive contents sit at the **root** of the tarball (`./bot.js`, `./install.sh`, `./forms/`),
not inside a subdirectory. That is what `-C bot .` achieves.

## 2. Start the stock Wickr IO container

```bash
IMG='public.ecr.aws/x3s2s6k3/wickrio/bot-cloud@sha256:<digest>'   # commercial
# GovCloud: public.ecr.aws/x3s2s6k3/wickrio/bot-cloud-govcloud@sha256:<digest>

docker run -d -it --restart=always --name wickrio-console "$IMG"

# Add this mount instead if the host uses a static credentials file rather than an
# instance profile (see "How the bot gets AWS credentials" above):
#   -v /home/<host-user>/.aws:/home/wickriouser/.aws

sleep 15 && docker ps
```

`-it` is required. Without it you cannot attach to the console, and the image prints a warning
saying so.

`--restart=always` matters more than it looks: the client database and the imported integration
live inside the container, so a container that does not come back after an instance reboot costs
you the whole import-and-configure sequence again.

Do not bind-mount over `/opt/WickrIO`. The image ships content there that the console needs, and
a host mount masks it.

## 3. Copy the tarball into the container

The console resolves the path **inside** the container, so the file has to be visible there.

```bash
docker cp software.tar.gz wickrio-console:/opt/WickrIO/software.tar.gz
docker exec wickrio-console gzip -t /opt/WickrIO/software.tar.gz && echo "archive OK"
```

The file must literally be named `software.tar.gz`. The console hardcodes that filename.

## 4. Attach to the console

```bash
docker attach wickrio-console
```

**Detach with `Ctrl+P` then `Ctrl+Q`.** Never `Ctrl+Z`, which sends SIGTSTP and stops the
container. Never `Ctrl+C`, which may kill WickrIOSvr.

## 5. Add the bot client

Type `add`.

| Prompt | Answer |
|---|---|
| User name | Your Wickr bot username |
| Password | The bot account password |
| Use autologin? | `yes` — lets the bot restart without retyping the password |

**Get the password right.** A wrong password does not produce a clean error: login fails, the
Wickr client tears down, and its shutdown path segfaults inside `libQt6Core`, killing WickrIOSvr
and stopping the whole container. You see only:

```
/home/wickriouser/start_user.sh: line 50: 656 Segmentation fault (core dumped) WickrIOSvr
```

Nothing in that message suggests a credentials problem. Confirm it in the client log before
suspecting anything else — see Troubleshooting below.

Expect `Successfully created user` and `Successfully logged in as new user!` on success.

## 6. Import the integration

The console then lists available bots and asks which to use. Type `import`.

| Prompt | Answer |
|---|---|
| Location of the integration to import | `/opt/WickrIO` — **the directory, not the file** |
| Integration name | `wickr-form-collection-bot` |

The directory answer is the single most common stumble. The prompt says "location of the
software.tar.gz file", but the console appends `/software.tar.gz` to whatever you type. Give it
the full file path and it replies `Cannot find the software.tar.gz file in that location!` even
though the file is right there.

The integration name must match the `name` field in `bot/wpm.json` and `bot/processes.json`.

The console then runs `install.sh`, which runs `npm install` — expect around 61 packages and no
compiler output, since nothing in the tree builds from source.

## 7. Answer the configuration prompts

| Token | Value |
|---|---|
| `AWS_REGION` | Your region |
| `BEDROCK_MODEL_ID` | Accept the default, or change it — `us.` prefix commercial, `us-gov.` GovCloud |
| `REPORTS_BUCKET` | S3 bucket for confirmed reports; blank skips S3 delivery |
| `TRANSCRIPTION_S3_BUCKET` | Bucket for voice memo transcription; blank disables it (voice memos then get an error reply) |
| `TRANSCRIBE_POLL_TIMEOUT_MS` | Blank for the code default |
| `LOG_LEVEL` | `INFO`, or `DEBUG` while bringing up |

These are written into `processes.json` and become environment variables for the bot. No AWS
access keys are prompted for and none should be: credentials come from the instance profile.

Ends with `Integration files written to /opt/WickrIO/clients/<bot>/integration/<name>` and
`Successfully added record to the database!`.

## 8. Start the bot

```
list
```

Confirm exactly one client. Then start it by index:

```
start 0
```

Enter the password again when prompted. `list` should now show `Running` with your integration
name and version.

Keep it to one client. A second client, or one left stuck in `Pausing`, is the orphan condition
that makes later console operations behave unpredictably.

## 9. Verify

From a **second** SSH session, without detaching from the console:

```bash
D=/opt/WickrIO/clients/<bot-username>/integration/wickr-form-collection-bot

docker exec wickrio-console ps aux | grep '[n]ode bot.js'
docker exec wickrio-console cat $D/bot.pid
docker exec wickrio-console tail -20 $D/wpm2.output
```

What good looks like:

```
wickrio+  1352  node bot.js
1352
{"timestamp":"...","level":"INFO","component":"bot","message":"bot_ready","startupDurationMs":180}
Bot message listener set successfully!
```

A running node process plus a matching `bot.pid` means `bot/start.sh` backgrounded node and
returned, which is what WickrIOSvr requires. Bot output goes to `wpm2.output`, not to the
container log — WickrIOSvr watches that filename to decide whether a paused client is still
producing output.

Then message the bot directly and confirm it replies. Room messages require the bot to be a
**room moderator**; without that Wickr delivers DMs but silently withholds room text, which
looks like a broken bot.

Continue with [USAGE.md](USAGE.md) — a deployed bot delivers nowhere until a delivery channel is
configured.

---

## Updating the bot

1. Rebuild `software.tar.gz` (step 1).
2. `docker cp` it into the container (step 3).
3. Attach to the console, `pause <n>`, then re-`import` into the same client.
4. `start <n>`.

`pause` runs `bot/stop.sh`, which reads the pid from `pidLocation.json` and terminates the node
process. Without a working `stop.sh` the console has no way to stop the integration, and orphaned
`node bot.js` processes accumulate across import cycles.

## Troubleshooting

**`Segmentation fault (core dumped) WickrIOSvr` right after `start`.** Almost always a wrong
password. Check the client log:

```bash
docker exec wickrio-console \
  grep -iE 'invalid|failed' /opt/WickrIO/clients/<bot>/logs/WickrIO<bot>.output
```

A wrong password shows:

```
WickrRegisterCheck: Failed, Error = "Either the username or password you entered was invalid."
USER LOGIN: Failed, Error = Invalid password
Database already exists must be bad credentials!
```

followed by `QObject::killTimer: Timers cannot be stopped from another thread` as the client tears
down — the Qt threading violation that produces the segfault. Recreate the container and retry
with the correct password; a failed login leaves a half-initialized client database behind.

**`Cannot find the software.tar.gz file in that location!`** You gave the file path. Give the
directory (step 6).

**Client reports `Running` but no node process exists.** `bot/start.sh` did not leave one running.
Check `wpm2.output` and the integration's `logs/log.output`. If `wpm.json` has a `node_args` value
the image's Node.js rejects, WPM retries forever with exponential backoff while the console still
reports `Running`. This repo ships `"node_args": []`; test any flag you add with
`node <flag> -e "1"` first.

**A credentials check with `docker exec` says no credentials, but the bot works.** Or the reverse.
`docker exec` does not reproduce the bot's environment: the image sets `HOME=/home/ubuntu`, while
the bot runs as `wickriouser` with `HOME=/home/wickriouser`. A process started by `docker exec`
therefore looks for `/home/ubuntu/.aws/credentials` and misses a correctly mounted file. To test
what the bot sees, override both:

```bash
docker exec -u wickriouser -e HOME=/home/wickriouser wickrio-console <command>
```

This does not affect the IMDS check above, which uses `curl` and does not read `HOME`.

**Bedrock or S3 calls fail with credentials errors.** Check the IMDS hop limit (see Requirements).
`000` from the token PUT means the container cannot reach the metadata service.

**Bot starts but ignores room messages.** It is not a room moderator.

See [MAINTENANCE.md](MAINTENANCE.md) for the full troubleshooting table.

## Not for production

This path depends on an interactive console session and a hand-typed password, and the bot's
lifecycle is tied to one EC2 instance with no automatic replacement. Use it to develop and to
verify a change quickly, then deploy the same `bot/` directory to ECS Fargate for anything real.
