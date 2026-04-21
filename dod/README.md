# DoD Staging

This directory holds DoD-specific form definitions and tests that are developed and maintained
alongside the generic bot but are NOT included in the AWS Samples public release.

**Do not copy the contents of this directory when publishing the bot to aws-samples.**

## Structure

```
dod/
  forms/                          # DoD form definitions (not loaded at runtime)
    salute.js                     # SALUTE enemy observation report
    medevac.js                    # 9-Line MEDEVAC request
    cas.js                        # 9-Line CAS brief
    perstat.js                    # PERSTAT (personnel status)
    flight-movement.js            # Flight Movement Report
    ground-movement.js            # Ground Movement Report
  test/                           # DoD form unit tests
    nineline-model.test.js
    property/                     # Property-based tests
      cas-model.property.test.js
      nineline-model.property.test.js
      salute-model.property.test.js
```

## Using DoD Forms Locally

The bot's `form-registry.js` loads all `.js` files from `bot/forms/` at startup. To run the bot
with DoD forms enabled for internal testing, copy the forms into `bot/forms/`:

```bash
cp dod/forms/*.js bot/forms/
```

To run the DoD test suite:

```bash
node --test dod/test/**/*.test.js
```

## Publishing to aws-samples

When cutting a release to aws-samples:

1. Create a clean checkout from this repo.
2. Delete the `dod/` directory entirely from the checkout.
3. Verify `bot/forms/` contains only the neutral example forms (`incident-report.js`,
   `shift-handoff.js`).
4. Run `grep -ri "dod\|military\|SALUTE\|MEDEVAC\|PERSTAT\|JTAC" .` from the project root
   and confirm zero matches.
5. Publish the cleaned checkout.
