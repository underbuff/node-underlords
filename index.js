const ByteBuffer = require('bytebuffer');
const EventEmitter = require('events').EventEmitter;
const SteamID = require('steamid');
const Util = require('util');

const Language = require('./language.js');
const Protos = require('./protobufs/generated/_load.js');

const STEAM_APPID = 1046930;

module.exports = Underlords;

Util.inherits(Underlords, EventEmitter);

function Underlords(steam) {
	if (steam.packageName != 'steam-user' || !steam.packageVersion || !steam.constructor) {
		throw new Error('underlords v2 only supports steam-user v4.2.0 or later.');
	} else {
		let parts = steam.packageVersion.split('.');
		if (parts[0] < 4 || parts[1] < 2) {
			throw new Error(`underlords v2 only supports steam-user v4.2.0 or later. ${steam.constructor.name} v${steam.packageVersion} given.`);
		}
	}

	this._steam = steam;
	this.haveGCSession = false;
	this._isInUnderlords = false;

	this._steam.on('receivedFromGC', (appid, msgType, payload) => {
		if (appid != STEAM_APPID) {
			return; // we don't care
		}

		let isProtobuf = !Buffer.isBuffer(payload);
		let handler = null;

		if (this._handlers[msgType]) {
			handler = this._handlers[msgType];
		}

		let msgName = msgType;
		for (let i in Language) {
			if (Language.hasOwnProperty(i) && Language[i] == msgType) {
				msgName = i;
				break;
			}
		}

		this.emit('debug', "Got " + (handler ? "handled" : "unhandled") + " GC message " + msgName + (isProtobuf ? " (protobuf)" : ""));
		if (handler) {
			handler.call(this, isProtobuf ? payload : ByteBuffer.wrap(payload, ByteBuffer.LITTLE_ENDIAN));
		}
	});

	this._steam.on('appLaunched', (appid) => {
		if (this._isInUnderlords) {
			return; // we don't care if it was launched again
		}

		if (appid == STEAM_APPID) {
			this._isInUnderlords = true;
			if (!this.haveGCSession) {
				this._connect();
			}
		}
	});

	let handleAppQuit = (emitDisconnectEvent) => {
		if (this._helloInterval) {
			clearInterval(this._helloInterval);
			this._helloInterval = null;
		}

		if (this.haveGCSession && emitDisconnectEvent) {
			this.emit('disconnectedFromGC', Underlords.GCConnectionStatus.NO_SESSION);
		}

		this._isInUnderlords = false;
		this.haveGCSession = false;
	};

	this._steam.on('appQuit', (appid) => {
		if (!this._isInUnderlords) {
			return;
		}

		if (appid == STEAM_APPID) {
			handleAppQuit(false);
		}
	});

	this._steam.on('disconnected', () => {
		handleAppQuit(true);
	});

	this._steam.on('error', (err) => {
		handleAppQuit(true);
	});
}

Underlords.prototype._connect = function() {
	if (!this._isInUnderlords || this._helloTimer) {
		this.emit('debug', "Not trying to connect due to " + (!this._isInUnderlords ? "not in Underlords" : "has helloTimer"));
		return; // We're not in CS:GO or we're already trying to connect
	}

	let sendHello = () => {
		if (!this._isInUnderlords) {
			this.emit('debug', "Not sending hello because we're no longer in CS:GO");
			delete this._helloTimer;
			return;
		} else if (this.haveGCSession) {
			this.emit('debug', "Not sending hello because we have a session");
			clearTimeout(this._helloTimer);
			delete this._helloTimer;
			return;
		}

		this._send(Language.ClientHello, Protos.CMsgClientHello, {});
		this._helloTimerMs = Math.min(60000, (this._helloTimerMs || 1000) * 2); // exponential backoff, max 60 seconds
		this._helloTimer = setTimeout(sendHello, this._helloTimerMs);
		this.emit('debug', "Sending hello, setting timer for next attempt to " + this._helloTimerMs + " ms");
	};

	this._helloTimer = setTimeout(sendHello, 500);
};

Underlords.prototype._send = function(type, protobuf, body) {
	if (!this._steam.steamID) {
		return false;
	}

	let msgName = type;
	for (let i in Language) {
		if (Language[i] == type) {
			msgName = i;
			break;
		}
	}

	this.emit('debug', "Sending GC message " + msgName);

	if (protobuf) {
		this._steam.sendToGC(STEAM_APPID, type, {}, protobuf.encode(body).finish());
	} else {
		// This is a ByteBuffer
		this._steam.sendToGC(STEAM_APPID, type, null, body.flip().toBuffer());
	}

	return true;
};

Underlords.prototype.requestProfile = function({ steamid }, callback) {
	if (typeof steamid == 'string') {
		steamid = new SteamID(steamid);
	}

	if (!steamid.isValid() || steamid.universe != SteamID.Universe.PUBLIC || steamid.type != SteamID.Type.INDIVIDUAL || steamid.instance != SteamID.Instance.DESKTOP) {
		return false;
	}

	this._send(Language.GetProfile, Protos.CMsgClientToGCGetProfile, {
		account_id: steamid.accountid
	});

	if(callback) {
		this.once('playersProfile', callback);
	}
};

Underlords.prototype.requestMatches = function({
	steamid,
	rows = 20,
	match_id_cursor = 0,
}, callback){
	if (typeof steamid == 'string') {
		steamid = new SteamID(steamid);
	}

	if (!steamid.isValid() || steamid.universe != SteamID.Universe.PUBLIC || steamid.type != SteamID.Type.INDIVIDUAL || steamid.instance != SteamID.Instance.DESKTOP) {
		return false;
	}

	this._send(Language.GetMatchHistory, Protos.CMsgClientToGCGetMatchHistory, {
		account_id: steamid.accountid,
		request_rows: rows,
		match_id_cursor
	});

	if(callback) {
		this.once('matchList', callback);
	}
}

Underlords.prototype.requestMatch = function({ match_id }, callback){
	this._send(Language.GetPostMatchStats, Protos.CMsgClientToGCGetPostMatchStats, {
		match_id
	});

	if(callback) {
		this.once('match', callback);
	}
}

Underlords.prototype.getFriendRanks = function(callback){
	this._send(Language.GetFriendRanks, Protos.CMsgClientToGCGetFriendRanks, {});

	if(callback) {
		this.once('friendRanks', callback);
	}
}

Underlords.prototype.spectateUser = function({ account_id, region_mode = 0 }, callback){
	this._send(Language.SpectateUser, Protos.CMsgClientToGCSpectateUser, {
		spectate_account_id: account_id,
		region_mode
	});

	if(callback) {
		this.once('spectateUser', callback);
	}
}

Underlords.prototype._handlers = {};

require('./enums.js');
require('./handlers.js');
