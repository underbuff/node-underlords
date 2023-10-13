const ByteBuffer = require('bytebuffer');
const Long = require('long');
const SteamID = require('steamid');

const Underlords = require('./index.js');
const Language = require('./language.js');
const Protos = require('./protobufs/generated/_load.js');

let handlers = Underlords.prototype._handlers;

// ClientWelcome and ClientConnectionStatus
handlers[Language.ClientWelcome] = function(body) {
	let proto = decodeProto(Protos.CMsgClientWelcome, body);

	this.emit('debug', "GC connection established");
	this.haveGCSession = true;
	clearTimeout(this._helloTimer);
	this._helloTimer = null;
	this._helloTimerMs = 1000;
	this.emit('connectedToGC');
};

handlers[Language.ClientConnectionStatus] = function(body) {
	let proto = decodeProto(Protos.CMsgConnectionStatus, body);
	this.emit('connectionStatus', proto.status, proto);

	let statusStr = proto.status;
	for (let i in Underlords.GCConnectionStatus) {
		if (Underlords.GCConnectionStatus.hasOwnProperty(i) && Underlords.GCConnectionStatus[i] == proto.status) {
			statusStr = i;
		}
	}

	this.emit('debug', "Connection status: " + statusStr + " (" + proto.status + "); have session: " + (this.haveGCSession ? 'yes' : 'no'));

	if (proto.status != Underlords.GCConnectionStatus.HAVE_SESSION && this.haveGCSession) {
		this.emit('disconnectedFromGC', proto.status);
		this.haveGCSession = false;
		this._connect(); // Try to reconnect
	}
};

// PlayersProfile
handlers[Language.GetProfileResponse] = function(body){
	let proto = decodeProto(Protos.CMsgClientToGCGetProfileResponse, body);
	this.emit('playersProfile', proto);
};

// MatchHistory
handlers[Language.GetMatchHistoryResponse] = function(body){
	let proto = decodeProto(Protos.CMsgClientToGCGetMatchHistoryResponse, body);
	this.emit('matchList', proto);
}

// Match Information
handlers[Language.GetPostMatchStatsResponse] = function(body){
	let proto = decodeProto(Protos.CMsgClientToGCGetPostMatchStatsResponse, body);
	this.emit('match', proto);
};

// Friends rank
handlers[Language.GetFriendRanksResponse] = function(body){
	let proto = decodeProto(Protos.CMsgClientToGCGetFriendRanksResponse, body);
	this.emit('friendRanks', proto);
};

// Spectate User
handlers[Language.SpectateUserResponse] = function(body){
	let proto = decodeProto(Protos.CMsgClientToGCSpectateUserResponse, body);
	this.emit('spectateUser', proto);
};

function decodeProto(proto, encoded) {
	if (ByteBuffer.isByteBuffer(encoded)) {
		encoded = encoded.toBuffer();
	}

	let decoded = proto.decode(encoded);
	let objNoDefaults = proto.toObject(decoded, {"longs": String});
	let objWithDefaults = proto.toObject(decoded, {"defaults": true, "longs": String});
	return replaceDefaults(objNoDefaults, objWithDefaults);

	function replaceDefaults(noDefaults, withDefaults) {
		if (Array.isArray(withDefaults)) {
			return withDefaults.map((val, idx) => replaceDefaults(noDefaults[idx], val));
		}

		for (let i in withDefaults) {
			if (!withDefaults.hasOwnProperty(i)) {
				continue;
			}

			if (withDefaults[i] && typeof withDefaults[i] === 'object' && !Buffer.isBuffer(withDefaults[i])) {
				// Covers both object and array cases, both of which will work
				// Won't replace empty arrays, but that's desired behavior
				withDefaults[i] = replaceDefaults(noDefaults[i], withDefaults[i]);
			} else if (typeof noDefaults[i] === 'undefined' && isReplaceableDefaultValue(withDefaults[i])) {
				withDefaults[i] = null;
			}
		}

		return withDefaults;
	}

	function isReplaceableDefaultValue(val) {
		if (Buffer.isBuffer(val) && val.length == 0) {
			// empty buffer is replaceable
			return true;
		}

		if (Array.isArray(val)) {
			// empty array is not replaceable (empty repeated fields)
			return false;
		}

		if (val === '0') {
			// Zero as a string is replaceable (64-bit integer)
			return true;
		}

		// Anything falsy is true
		return !val;
	}
}
