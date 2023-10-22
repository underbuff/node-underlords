const SteamUser = require('steam-user');
const Underlords = require('../build').Underlords
const acc = require('./account.json')

let client = new SteamUser();
let underlordsClient = new Underlords(client);

client.logOn({
    accountName: acc.login,
    password: acc.password
});

const steamIdMain = '76561199218271603'

client.on('loggedOn', function(details) {
    console.log('Logged into Steam as ' + client.steamID.getSteam3RenderedID());
    client.setPersona(SteamUser.EPersonaState.Online, 'Underbuff Bot');
    client.gamesPlayed(1046930);
});

underlordsClient.on('connectedToGC', (...args) => {
    console.log('connected to GC', args)

    underlordsClient.requestMatches({
        steamid: steamIdMain,
        rows: 2
    }, console.log);

    //underlordsClient.requestProfile({ steamid: steamIdMain }, console.log)

    /*underlordsClient.requestMatch({ match_id: 129784686 }, res => {
        console.log(res)
    })*/
    //underlordsClient.getFriendRanks(console.log)
    //underlordsClient.spectateUser({ account_id: 1258005875, }, console.log)
});

underlordsClient.on('debug', console.log)
