// Streaming apps we recognise on Samsung TVs. `ids` are Tizen app ids seen on
// 2020-2024 sets, most preferred first (when a TV lists two, e.g. YouTube and
// its Cobalt twin, the earlier id wins). `match` catches the same app by its
// display name when the id differs by year or region. Colours are only used
// for the monogram tile when the TV gives no icon.
(function (root) {
  'use strict';
  const CH = root.CleanHub = root.CleanHub || {};

  CH.catalog = [
    { key: 'netflix', ids: ['org.tizen.netflix-app', 'RN1MCdNq8t.Netflix'], name: 'Netflix', match: /^netflix\b/i, mono: 'N', bg: '#E50914', fg: '#FFFFFF' },
    { key: 'youtube', ids: ['9Ur5IzDKqV.TizenYouTube', 'com.samsung.tv.cobalt-yt'], name: 'YouTube', match: /^youtube$/i, mono: 'YT', bg: '#FF0033', fg: '#FFFFFF' },
    { key: 'prime', ids: ['org.tizen.primevideo', 'org.tizen.ignition'], name: 'Prime Video', match: /^(amazon )?prime video\b/i, mono: 'pv', bg: '#00A8E1', fg: '#0F1111' },
    { key: 'disney', ids: ['MCmYXNxgcu.DisneyPlus'], name: 'Disney+', match: /^disney\s*\+|^disney plus\b/i, mono: 'D+', bg: '#0E2A8A', fg: '#FFFFFF' },
    { key: 'hulu', ids: ['LBUAQX1exg.Hulu'], name: 'Hulu', match: /^hulu\b/i, mono: 'hulu', bg: '#1CE783', fg: '#0B0C0F' },
    { key: 'max', ids: ['5b8c3eb16b.BeamCTVDev', 'cj37Ni3qXM.HBONow'], name: 'HBO Max', match: /^(hbo )?max$|^hbo max\b/i, mono: 'HBO', bg: '#002BE7', fg: '#FFFFFF' },
    { key: 'appletv', ids: ['com.samsung.tv.aria-video', 'com.samsung.tv.ariavideo'], name: 'Apple TV', match: /^apple tv\b/i, mono: 'tv', bg: '#1D1D1F', fg: '#FFFFFF' },
    { key: 'peacock', ids: ['gzcc4LRFBF.Peacock'], name: 'Peacock', match: /^peacock\b/i, mono: 'P', bg: '#0A0A0A', fg: '#F9C80E' },
    { key: 'paramount', ids: ['rJyOSqC6Up.CBSAllAccess', 'rJyOSqC6Up.PPlusIntl'], name: 'Paramount+', match: /^paramount\s*(\+|plus)/i, mono: 'P+', bg: '#0064FF', fg: '#FFFFFF' },
    { key: 'youtubetv', ids: ['PvWgqxV3Xa.YouTubeTV', 'com.samsung.tv.cobalt-yttv'], name: 'YouTube TV', match: /^youtube ?tv$/i, mono: 'YTV', bg: '#282828', fg: '#FF0033' },
    { key: 'plex', ids: ['kIciSQlYEM.plex'], name: 'Plex', match: /^plex\b/i, mono: 'plex', bg: '#1F1F1F', fg: '#E5A00D' },
    { key: 'jellyfin', ids: ['AprZAARz4r.Jellyfin'], name: 'Jellyfin', match: /^jellyfin\b/i, mono: 'JF', bg: '#101010', fg: '#AA5CC3' },
    { key: 'tubi', ids: ['3KA0pm7a7V.TubiTV'], name: 'Tubi', match: /^tubi\b/i, mono: 'tubi', bg: '#7408FF', fg: '#FFFF13' },
    { key: 'pluto', name: 'Pluto TV', match: /^pluto\s*tv\b/i, mono: 'P', bg: '#111111', fg: '#FFF200' },
    { key: 'tvplus', ids: ['com.samsung.tv.tvplus', 'HEPsqFNie0.tvplusstandalone'], name: 'Samsung TV Plus', match: /^samsung tv plus\b/i, mono: 'TV+', bg: '#1428A0', fg: '#FFFFFF' },
    { key: 'spotify', ids: ['rJeHak5zRg.Spotify'], name: 'Spotify', match: /^spotify\b/i, mono: 'S', bg: '#1DB954', fg: '#0B0C0F' },
    { key: 'twitch', ids: ['Jz7aUrV2Q4.Twitch'], name: 'Twitch', match: /^twitch\b/i, mono: 'tw', bg: '#9146FF', fg: '#FFFFFF' },
    { key: 'crunchyroll', name: 'Crunchyroll', match: /^crunchyroll\b/i, mono: 'CR', bg: '#F47521', fg: '#FFFFFF' },
    { key: 'sling', ids: ['ZmmGjO6VKO.slingtv'], name: 'Sling TV', match: /^sling\b/i, mono: 'S', bg: '#0072CE', fg: '#FFFFFF' },
    { key: 'espn', ids: ['XtU8fQk2gN.ESPN'], name: 'ESPN', match: /^espn\b/i, mono: 'E', bg: '#CC0000', fg: '#FFFFFF' },
    { key: 'fubo', name: 'Fubo', match: /^fubo\b/i, mono: 'fubo', bg: '#FA4616', fg: '#FFFFFF' },
    { key: 'philo', name: 'Philo', match: /^philo\b/i, mono: 'ph', bg: '#5E2CED', fg: '#FFFFFF' },
    { key: 'starz', name: 'Starz', match: /^starz\b/i, mono: 'S', bg: '#000000', fg: '#FFFFFF' },
    { key: 'apple-music', ids: ['org.tizen.apple.apple-music'], name: 'Apple Music', match: /^apple music\b/i, mono: '♪', bg: '#FA243C', fg: '#FFFFFF' },
    { key: 'kids', ids: ['com.samsung.tv.cobalt-ytkids'], name: 'YouTube Kids', match: /^youtube kids\b/i, mono: 'YK', bg: '#FF0033', fg: '#FFFFFF' },
    { key: 'browser', ids: ['org.tizen.browser', 'com.samsung.tv.knox-browser'], name: null, match: /^(samsung )?internet$|^browser$/i, mono: 'www', bg: '#3B4BDB', fg: '#FFFFFF' },
    // Seen on the QN85B this was built for (sdb applist, 2026-10-20).
    { key: 'xbox', ids: ['GHI3a0zMSx.XboxGamePass'], name: 'Xbox', match: /^xbox\b/i, mono: 'X', bg: '#107C10', fg: '#FFFFFF' },
    { key: 'geforce', ids: ['w0wZu3xkQq.GeForceNOW'], name: 'GeForce NOW', match: /^geforce now\b/i, mono: 'GF', bg: '#1A1A1A', fg: '#76B900' },
    { key: 'luna', ids: ['CmeyUlnhYY.LunaWebApp'], name: 'Amazon Luna', match: /^(amazon )?luna\b/i, mono: 'L', bg: '#2B1B5C', fg: '#C8A6FF' },
    { key: 'pbs', ids: ['70fRFUwYlD.OtterGAProd'], name: 'PBS Video', match: /^pbs video\b/i, mono: 'PBS', bg: '#2638C4', fg: '#FFFFFF' },
    { key: 'pbskids', ids: ['Rk72oKFsRS.OtterKidsProd'], name: 'PBS KIDS Video', match: /^pbs kids\b/i, mono: 'KIDS', bg: '#0B8A3E', fg: '#FFFFFF' },
    { key: 'amcplus', ids: ['Ob3XhAVMu6.amcplus'], name: 'AMC+', match: /^amc\s*\+|^amc plus\b/i, mono: 'AMC', bg: '#111111', fg: '#FFFFFF' },
    { key: 'freevee', ids: ['OK2Rdkjmsi.IMDbTV'], name: 'Freevee', match: /^freevee\b/i, mono: 'fv', bg: '#1F1F1F', fg: '#43D9AD' },
    { key: 'viaplay', ids: ['niYSnzL6h1.Viaplay'], name: 'Viaplay', match: /^viaplay\b/i, mono: 'V', bg: '#2C0E37', fg: '#FF3C8C' },
    { key: 'instagram', ids: ['zigzSWa1hy.InstagramAirwave'], name: 'Instagram', match: /^instagram\b/i, mono: 'IG', bg: '#C13584', fg: '#FFFFFF' },
    { key: 'health', ids: ['com.samsung.tv.samsung-health'], name: 'Samsung Health', match: /^samsung health\b/i, mono: 'SH', bg: '#0E7C86', fg: '#FFFFFF' },
    { key: 'meet', ids: ['IewQEY143t.GoogleDuoWeb'], name: 'Google Meet', match: /^google meet\b/i, mono: 'GM', bg: '#174EA6', fg: '#FFFFFF' }
  ];

  // Order the home screen uses the first time, before the viewer picks apps.
  CH.defaultOrder = ['netflix', 'youtube', 'prime', 'disney', 'hulu', 'max', 'appletv',
    'peacock', 'paramount', 'youtubetv', 'plex', 'jellyfin', 'tubi', 'pluto', 'spotify'];
  CH.defaultLimit = 8;
})(typeof window !== 'undefined' ? window : globalThis);
