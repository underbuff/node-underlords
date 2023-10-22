import ByteBuffer from 'bytebuffer'
import { EventEmitter } from 'events'
import SteamID from 'steamid'
import SteamUser from 'steam-user'
import { MessageID, GCConnectionStatus, CallbackFunction } from './types'
import { decodeProto } from './helpers'
// @ts-ignore
import Protos from '../protobufs/generated/_load.js';

const STEAM_APPID = 1046930;

export class Underlords extends EventEmitter {
    protected _steam: SteamUser;
    protected _isInUnderlords: boolean;
    protected _helloTimer?: NodeJS.Timeout | null = null;
    protected _helloInterval: NodeJS.Timeout | null = null;
    protected _helloTimerMs?: number;
    protected _handlers: { [key in MessageID]?: (body: any) => void };
    public haveGCSession: boolean;

    protected _send(type: MessageID, protobuf: any, body: any) {
        if (!this._steam.steamID) {
            return false;
        }

        let msgName = MessageID[type]

        this.emit('debug', "Sending GC message " + msgName);

        if (protobuf) {
            this._steam.sendToGC(STEAM_APPID, type, {}, protobuf.encode(body).finish());
        } else {
            // This is a ByteBuffer
            this._steam.sendToGC(STEAM_APPID, type, null, body.flip().toBuffer());
        }

        return true;
    };

    protected _connect() {
        if (!this._isInUnderlords || this._helloTimer) {
            this.emit('debug', "Not trying to connect due to " + (!this._isInUnderlords ? "not in Underlords" : "has helloTimer"));
            return;
        }

        let sendHello = () => {
            if (!this._isInUnderlords) {
                this.emit('debug', "Not sending hello because we're no longer in CS:GO");
                delete this._helloTimer;
                return;
            } else if (this.haveGCSession) {
                this.emit('debug', "Not sending hello because we have a session");
                this._helloTimer && clearTimeout(this._helloTimer);
                delete this._helloTimer;
                return;
            }

            this._send(MessageID.ClientHello, Protos.CMsgClientHello, {});
            this._helloTimerMs = Math.min(60000, (this._helloTimerMs || 1000) * 2); // exponential backoff, max 60 seconds
            this._helloTimer = setTimeout(sendHello, this._helloTimerMs);
            this.emit('debug', "Sending hello, setting timer for next attempt to " + this._helloTimerMs + " ms");
        };

        this._helloTimer = setTimeout(sendHello, 500);
    };

     protected handleAppQuit(emitDisconnectEvent: boolean) {
        if (this._helloInterval) {
            clearInterval(this._helloInterval);
            this._helloInterval = null;
        }

        if (this.haveGCSession && emitDisconnectEvent) {
            this.emit('disconnectedFromGC', GCConnectionStatus.NO_SESSION);
        }

        this._isInUnderlords = false;
        this.haveGCSession = false;
    };

    constructor(steam: SteamUser) {
        super();

        this._steam = steam
        this.haveGCSession = false;
        this._isInUnderlords = false;

        this._handlers = {
            [MessageID.ClientWelcome]: () => {
                this.emit('debug', "GC connection established");
                this.haveGCSession = true;
                this._helloTimer && clearTimeout(this._helloTimer);
                this._helloTimer = null;
                this._helloTimerMs = 1000;
                this.emit('connectedToGC');
            },
            [MessageID.ClientConnectionStatus]: body => {
                let proto = decodeProto(Protos.CMsgConnectionStatus, body);
                this.emit('connectionStatus', proto.status, proto);

                let statusStr = proto.status;
                for (let i in GCConnectionStatus) {
                    if (GCConnectionStatus.hasOwnProperty(i) && GCConnectionStatus[i] === proto.status) {
                        statusStr = i;
                    }
                }

                this.emit('debug', "Connection status: " + statusStr + " (" + proto.status + "); have session: " + (this.haveGCSession ? 'yes' : 'no'));

                if (proto.status !== GCConnectionStatus.HAVE_SESSION && this.haveGCSession) {
                    this.emit('disconnectedFromGC', proto.status);
                    this.haveGCSession = false;
                    this._connect(); // Try to reconnect
                }
            },
            [MessageID.GetProfileResponse]: body => {
                let proto = decodeProto(Protos.CMsgClientToGCGetProfileResponse, body);
                this.emit('playersProfile', proto);
            },
            [MessageID.GetMatchHistoryResponse]: body => {
                let proto = decodeProto(Protos.CMsgClientToGCGetMatchHistoryResponse, body);
                this.emit('matchList', proto);
            },
            [MessageID.GetPostMatchStatsResponse]: body => {
                let proto = decodeProto(Protos.CMsgClientToGCGetPostMatchStatsResponse, body);
                this.emit('match', proto);
            },
            [MessageID.GetFriendRanksResponse]: body => {
                let proto = decodeProto(Protos.CMsgClientToGCGetFriendRanksResponse, body);
                this.emit('friendRanks', proto);
            },
            [MessageID.SpectateUserResponse]: body => {
                let proto = decodeProto(Protos.CMsgClientToGCSpectateUserResponse, body);
                this.emit('spectateUser', proto);
            },
        }

        this._steam.on('receivedFromGC', (appid, msgType: MessageID, payload) => {
            if (appid != STEAM_APPID) {
                return; // we don't care
            }

            let isProtobuf = !Buffer.isBuffer(payload);
            let handler = null;

            if (this._handlers[msgType]) {
                handler = this._handlers[msgType];
            }

            let msgName = MessageID[msgType]

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

        this._steam.on('appQuit', (appid) => {
            if (!this._isInUnderlords) {
                return;
            }

            if (appid == STEAM_APPID) {
                this.handleAppQuit(false);
            }
        });

        this._steam.on('disconnected', () => {
            this.handleAppQuit(true);
        });

        this._steam.on('error', () => {
            this.handleAppQuit(true);
        });
    }

    protected isValidSteamId(id: SteamID): boolean {
        return !(!id.isValid() || id.universe != SteamID.Universe.PUBLIC || id.type != SteamID.Type.INDIVIDUAL || id.instance != SteamID.Instance.DESKTOP)
    }

    public requestProfile(args: { steamid: string }, callback: CallbackFunction): boolean {
        let id = new SteamID(args.steamid)

        if (!this.isValidSteamId(id)) {
            return false;
        }

        this._send(MessageID.GetProfile, Protos.CMsgClientToGCGetProfile, {
            account_id: id.accountid
        });

        if (callback) {
            this.once('playersProfile', callback);
        }

        return true
    };

    public requestMatches({
        steamid,
        rows = 20,
        match_id_cursor = 0,
    }: {
        steamid: string,
        rows?: number,
        match_id_cursor?: number
    }, callback: CallbackFunction): boolean {
        let id = new SteamID(steamid)

        if (!this.isValidSteamId(id)) {
            return false;
        }

        this._send(MessageID.GetMatchHistory, Protos.CMsgClientToGCGetMatchHistory, {
            account_id: id.accountid,
            request_rows: rows,
            match_id_cursor
        });

        if (callback) {
            this.once('matchList', callback);
        }

        return true
    }

    public requestMatch({ match_id }: { match_id: number }, callback: CallbackFunction){
        this._send(MessageID.GetPostMatchStats, Protos.CMsgClientToGCGetPostMatchStats, {
            match_id
        });

        if (callback) {
            this.once('match', callback);
        }
    }

    public getFriendRanks(callback: CallbackFunction){
        this._send(MessageID.GetFriendRanks, Protos.CMsgClientToGCGetFriendRanks, {});

        if (callback) {
            this.once('friendRanks', callback);
        }
    }

    public spectateUser({
        account_id,
        region_mode = 0
    }: {
        account_id: number,
        region_mode?: number
    }, callback: CallbackFunction){
        this._send(MessageID.SpectateUser, Protos.CMsgClientToGCSpectateUser, {
            spectate_account_id: account_id,
            region_mode
        });

        if (callback) {
            this.once('spectateUser', callback);
        }
    }
}
