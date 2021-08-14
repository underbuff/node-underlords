# Underlords GC for Node.js

This module provides a very flexible interface for interacting with the [Underlords](http://store.steampowered.com/app/1046930)
Game Coordinator. It's designed to work with a
[node-steam-user SteamUser](https://github.com/DoctorMcKay/node-steam-user) instance.

This is based off of [node-tf2](https://github.com/DoctorMcKay/node-tf2).

**You will need node-steam-user v4.2.0 or later and Node.js v8 or later.**

# Setup

First, install it from npm:

	$ npm install dota-underlords

Require the module and call its constructor with your SteamUser instance:

```js
const SteamUser = require('steam-user');
const Underlords = require('dota-underlords');

let user = new SteamUser();
let underlords = new Underlords(user);
```

To initialize your GC connection, just launch Underlords via SteamUser normally:

```js
client.gamesPlayed([1046930]);
```

Underlords will emit a `connectedToGC` event when the game coordinator connection has been successfully
established. You shouldn't try to do anything before you receive that event.

# Enums

There are some enums that are used by various methods and events. You can find them in `enums.js`.

# Properties

There are a few useful read-only properties available to you.

### haveGCSession

`true` if we're currently connected to the GC, `false` otherwise. You should only call methods when we have an active GC session.

# Methods

### Constructor(steamClient)

When instantiating your underlords instance, you need to pass your active Steam.SteamClient instance as the sole parameter, as shown here:

```js
var underlords = new Underlords(steamClient);
```

### requestProfile(steamid[, callback])
- `steamid` - The numeric SteamID of the Steam account to pull profile data for.
- `callback` - Called if all parameters are valid when Steam responds to us.

### requestMatches(steamid[, callback])
- `steamid` - The numeric SteamID of the Steam account to pull profile data for.
- `rows` - The amount numbers of matches.
- `callback` - Called if all parameters are valid when Steam responds to us.

Note: This method ONlY works for your account

### requestMatch(match_id[, callback])
- `match_id` - You can get the match number from the `requestMatches` method.
- `callback` - Called if all parameters are valid when Steam responds to us.

# Events

### connectedToGC

Emitted when a GC connection is established. You shouldn't use any methods before you receive this. Note that this may be received (after it's first emitted) without any disconnectedFromGC event being emitted. In this case, the GC simply restarted.

### disconnectedFromGC
- `reason` - A value from the `GCConnectionStatus` enum

Emitted when we're disconnected from the GC for any reason. underlords will automatically try to reconnect and will emit `connectedToGC` when reconnected.

Example usage:

```js
const Underlords = require('dota-underlords');
let underlordsClient = new Underlords(steamUser);

underlordsClient.on('disconnectedFromGC', (reason) => {
    if (reason == underlordsClient.GCConnectionStatus.GC_GOING_DOWN) {
        console.log('GC going down');    
    }
});
```

### connectionStatus
- `status` - A value from the `GCConnectionStatus` enum
- `data` - The raw data that was received

Emitted when we receive the status of our connection to the GC. Exactly when this is emitted is currently unknown. **This may be removed in the future.**
