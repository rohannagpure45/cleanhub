// Streaming apps we recognise on Samsung TVs. Names are matched against the
// name Tizen reports for each installed app; ids are extra hints when known.
// Colors are only used for the monogram tile when the TV gives no icon.
(function (root) {
  'use strict';
  const CH = root.CleanHub = root.CleanHub || {};

  CH.catalog = [
    { key: 'netflix', name: 'Netflix', match: /^netflix\b/i, mono: 'N', bg: '#E50914', fg: '#FFFFFF' },
    { key: 'youtube', name: 'YouTube', match: /^youtube$/i, mono: 'YT', bg: '#FF0033', fg: '#FFFFFF' },
    { key: 'prime', name: 'Prime Video', match: /^(amazon )?prime video\b/i, mono: 'pv', bg: '#00A8E1', fg: '#0F1111' },
    { key: 'disney', name: 'Disney+', match: /^disney\s*\+|^disney plus\b/i, mono: 'D+', bg: '#0E2A8A', fg: '#FFFFFF' },
    { key: 'hulu', name: 'Hulu', match: /^hulu\b/i, mono: 'hulu', bg: '#1CE783', fg: '#0B0C0F' },
    { key: 'max', name: 'Max', match: /^(hbo )?max$|^hbo max\b/i, mono: 'max', bg: '#002BE7', fg: '#FFFFFF' },
    { key: 'appletv', name: 'Apple TV', match: /^apple tv\b/i, mono: 'tv', bg: '#1D1D1F', fg: '#FFFFFF' },
    { key: 'peacock', name: 'Peacock', match: /^peacock\b/i, mono: 'P', bg: '#0A0A0A', fg: '#F9C80E' },
    { key: 'paramount', name: 'Paramount+', match: /^paramount\s*(\+|plus)/i, mono: 'P+', bg: '#0064FF', fg: '#FFFFFF' },
    { key: 'youtubetv', name: 'YouTube TV', match: /^youtube ?tv$/i, mono: 'YTV', bg: '#282828', fg: '#FF0033' },
    { key: 'plex', name: 'Plex', match: /^plex\b/i, mono: 'plex', bg: '#1F1F1F', fg: '#E5A00D' },
    { key: 'jellyfin', name: 'Jellyfin', match: /^jellyfin\b/i, mono: 'JF', bg: '#101010', fg: '#AA5CC3' },
    { key: 'tubi', name: 'Tubi', match: /^tubi\b/i, mono: 'tubi', bg: '#7408FF', fg: '#FFFF13' },
    { key: 'pluto', name: 'Pluto TV', match: /^pluto\s*tv\b/i, mono: 'P', bg: '#111111', fg: '#FFF200' },
    { key: 'tvplus', name: 'Samsung TV Plus', match: /^samsung tv plus\b/i, mono: 'TV+', bg: '#1428A0', fg: '#FFFFFF' },
    { key: 'spotify', name: 'Spotify', match: /^spotify\b/i, mono: 'S', bg: '#1DB954', fg: '#0B0C0F' },
    { key: 'twitch', name: 'Twitch', match: /^twitch\b/i, mono: 'tw', bg: '#9146FF', fg: '#FFFFFF' },
    { key: 'crunchyroll', name: 'Crunchyroll', match: /^crunchyroll\b/i, mono: 'CR', bg: '#F47521', fg: '#FFFFFF' },
    { key: 'sling', name: 'Sling TV', match: /^sling\b/i, mono: 'S', bg: '#0072CE', fg: '#FFFFFF' },
    { key: 'espn', name: 'ESPN', match: /^espn\b/i, mono: 'E', bg: '#CC0000', fg: '#FFFFFF' },
    { key: 'fubo', name: 'Fubo', match: /^fubo\b/i, mono: 'fubo', bg: '#FA4616', fg: '#FFFFFF' },
    { key: 'philo', name: 'Philo', match: /^philo\b/i, mono: 'ph', bg: '#5E2CED', fg: '#FFFFFF' },
    { key: 'starz', name: 'Starz', match: /^starz\b/i, mono: 'S', bg: '#000000', fg: '#FFFFFF' },
    { key: 'apple-music', name: 'Apple Music', match: /^apple music\b/i, mono: '♪', bg: '#FA243C', fg: '#FFFFFF' },
    { key: 'kids', name: 'YouTube Kids', match: /^youtube kids\b/i, mono: 'YK', bg: '#FF0033', fg: '#FFFFFF' },
    { key: 'browser', name: 'Internet', match: /^(samsung )?internet$/i, mono: 'www', bg: '#3B4BDB', fg: '#FFFFFF' }
  ];

  // Order the home screen uses the first time, before the viewer picks apps.
  CH.defaultOrder = ['netflix', 'youtube', 'prime', 'disney', 'hulu', 'max', 'appletv',
    'peacock', 'paramount', 'youtubetv', 'plex', 'jellyfin', 'tubi', 'pluto', 'spotify'];
  CH.defaultLimit = 8;
})(typeof window !== 'undefined' ? window : globalThis);
