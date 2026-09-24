// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

// Stub for the wickrio_addon native module, which is only available inside the
// Wickr IO container. Bot code should never require this directly -- it should
// use bot.getWickrIOAddon() -- but this stub keeps any transitive require from
// failing during tests.
module.exports = {};
