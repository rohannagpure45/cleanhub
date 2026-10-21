// Brainrot mode's words: every video, caption and comment in the feed is put
// together here from word lists and a seed, so the feed never runs out, needs
// no network, and the same seed always gives the same video (tests rely on it).
// Emoji are tokens (:skull:) that reel.js draws, since the TV may lack an
// emoji font.
(function (root) {
  'use strict';
  const CH = root.CleanHub = root.CleanHub || {};

  // mulberry32: small, fast, good enough for picking words.
  function random(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(rnd, list) {
    return list[Math.floor(rnd() * list.length)];
  }

  // n distinct items, in their list order.
  function some(rnd, list, n) {
    const idx = list.map(function (x, i) { return i; });
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = idx[i];
      idx[i] = idx[j];
      idx[j] = tmp;
    }
    return idx.slice(0, n).sort(function (a, b) { return a - b; }).map(function (i) { return list[i]; });
  }

  const BANK = {
    who: ['roommate', 'lab partner', 'little cousin', 'gym bro', 'unc', 'situationship', 'group project partner',
      'math teacher', 'barber', 'pookie', 'Uber driver', 'manager'],
    thing: ['last chicken nugget', 'birthday cake', 'gaming chair', 'LED strip lights', 'mystery sandwich', 'air fryer',
      'emotional support hoodie', 'leftover pizza', 'mewing streak', 'phone charger', 'fries'],
    place: ['Ohio', 'the cafeteria', 'a gas station at 3am', 'my cousin’s wedding', 'the group chat', 'the school talent show',
      'the dentist', 'a job interview', 'the library', 'church'],
    phrase: ['skibidi', 'six seven', 'erm what the sigma', 'chat is this real', 'it’s giving Ohio', 'you’re cooked',
      'that’s not very sigma of you', 'bro thinks he’s him', 'aura check', 'no cap fr fr'],
    insult: ['an NPC', 'cooked', 'chopped', 'a certified yapper', 'the Ohio final boss', 'delulu', 'not him', 'a glazer',
      'down bad', 'mid'],
    verb: ['fanum taxing', 'mogging', 'ratioing', 'glazing', 'aura farming on', 'rizzing up', 'side-eyeing'],
    did: ['fanum taxed', 'mogged', 'ratioed', 'aura farmed on', 'side-eyed', 'speedran'],
    stat: ['aura', 'rizz', 'sigma energy', 'mewing points', 'main character energy'],
    num: ['3', '12', '40', '67', '100', '365'],
    ending: ['ending', 'last part', 'second guy', 'sound', 'ball at the end', 'corner', 'background music']
  };

  const HANDLE = {
    head: ['sigma', 'skibidi', 'rizz', 'aura', 'ohio', 'mewing', 'npc', 'goofy', 'brainrot', 'fanum', 'delulu', 'cooked'],
    tail: ['_king', '.daily', 'lord', '_fr', '.edits', '_unc', 'maxxer', '_official', '_67', 'core', '.clips', '_tv']
  };

  const TAGS = ['#fyp', '#foryou', '#brainrot', '#skibidi', '#sigma', '#ohio', '#rizz', '#aura', '#viral', '#mewing',
    '#cooked', '#67'];

  const STORY = {
    title: [
      'AITA for {verb} my {who}’s {thing}?',
      'AITA for telling my {who} they have zero {stat}?',
      'WIBTA if I left {place} because my {who} said “{phrase}”?'
    ],
    open: 'So my {who} has been mewing for {num} days straight.',
    middle: [
      'Yesterday they walked into {place} and said “{phrase}” with zero hesitation.',
      'Chat, the aura loss was immeasurable.',
      'So I {did} their {thing}. That is literally the rule.',
      'They hit me with the bombastic side eye.',
      'Now the whole group chat says I’m {insult}.',
      'Mind you, this was in {place}.',
      'They said I have negative {stat}. Negative.',
      'I said “{phrase}” and walked out.'
    ],
    close: ['So AITA? Or are they just {insult}?', 'Edit: they are mewing at me right now :skull:',
      'Update: we are both {insult} :sob:']
  };

  const AURA = [
    ['mewing during the fire drill', 1500],
    ['tripping in front of your crush', -2000],
    ['saying “you too” when the waiter says enjoy', -500],
    ['walking away from an explosion without looking', 5000],
    ['replying “k”', -300],
    ['eating the last nugget without asking', -1000],
    ['getting fanum taxed', -800],
    ['finishing the group project alone', 2500],
    ['holding the door for 9 people', 900],
    ['laughing at your own joke first', -700],
    ['parallel parking first try', 3000],
    ['the teacher calling you the wrong name', -400],
    ['knowing every word to the song', 1200],
    ['waving back at someone who waved at the person behind you', -1500],
    ['saying six seven in class', 67],
    ['leaving the group chat on read', 600],
    ['catching your phone mid-fall', 2000],
    ['your mic was on the whole time', -3000]
  ];

  // Italian brainrot. Each `id` is a character reel.js knows how to draw.
  const ITALIAN = [
    { id: 'tung', name: 'Tung Tung Tung Sahur', chant: 'tung tung tung tung tung tung tung tung tung sahur' },
    { id: 'tralalero', name: 'Tralalero Tralala', chant: 'tralalero tralala, a shark with three pairs of sneakers' },
    { id: 'cappuccina', name: 'Ballerina Cappuccina', chant: 'ballerina cappuccina, mi mi mi mi mi' },
    { id: 'bananini', name: 'Chimpanzini Bananini', chant: 'chimpanzini bananini, wa wa wa wa' },
    { id: 'crocodilo', name: 'Bombardiro Crocodilo', chant: 'bombardiro crocodilo, flying over the cafeteria' }
  ];

  const COMMENTS = [
    'the {ending} :sob:', 'W {stat}', 'bro is NOT him :skull:', 'who’s here in 2026?', 'first', 'chat is this real',
    'this is peak :fire:', 'not the {thing} :sob::sob:', 'i’m crying at 0:{num}', '{phrase} :moai:', 'mewing rn',
    'the aura on this one :fire:', 'POV: {place}', 'nah this is crazy', 'my brain is cooked', 'bro got fanum taxed',
    'this gave me {num} aura', 'L {who}', 'average {place} moment', 'ok but the {thing}?', 'six seven :skull:',
    'erm what the sigma', 'i need the sound', 'part 2 pls', 'algorithm brought me here', 'teacher said no phones :skull:',
    'the {who} is {insult} :skull:', 'replayed {num} times'
  ];

  // Order of video kinds down the feed; the story (split screen) comes round twice.
  const KINDS = ['story', 'bounce', 'aura', 'italian', 'story', 'dvd'];

  const WORD_S = 0.34; // caption pace, seconds per word
  const AURA_S = 3.2; // each aura rating stays this long

  function fill(text, vars) {
    return text.replace(/\{(\w+)\}/g, function (m, k) {
      return vars[k] !== undefined ? vars[k] : m;
    });
  }

  // One word of each bank, fixed for a whole video so a story keeps its cast.
  function cast(rnd) {
    const vars = {};
    Object.keys(BANK).forEach(function (k) { vars[k] = pick(rnd, BANK[k]); });
    return vars;
  }

  function handle(rnd) {
    return pick(rnd, HANDLE.head) + pick(rnd, HANDLE.tail);
  }

  // Lines become timed words, shown a few at a time like TikTok captions.
  // Each line runs `dur` seconds (default: its words at WORD_S each).
  // Returns { chunks: [{ words: [{ text, at }], end }], end }.
  function timeline(lines, start) {
    const chunks = [];
    let at = start || 0;
    lines.forEach(function (line) {
      const words = String(line.text).split(/\s+/).filter(Boolean);
      if (!words.length) return;
      const per = line.dur ? line.dur / words.length : WORD_S;
      const size = line.dur ? words.length : 3; // timed lines (aura) show whole
      for (let i = 0; i < words.length; i += size) {
        const chunk = { words: [], end: 0 };
        words.slice(i, i + size).forEach(function (w) {
          chunk.words.push({ text: w, at: at });
          at += per;
        });
        chunk.end = at;
        chunks.push(chunk);
      }
    });
    return { chunks: chunks, end: at };
  }

  function story(rnd, v) {
    const lines = [STORY.open].concat(some(rnd, STORY.middle, 4), [pick(rnd, STORY.close)]);
    const tl = timeline(lines.map(function (l) { return { text: fill(l, v) }; }), 0.6);
    return {
      title: fill(pick(rnd, STORY.title), v),
      sub: 'r/AmItheAsshole',
      timeline: tl,
      duration: tl.end + 1.2
    };
  }

  function bounce(rnd, v) {
    const rings = 5 + Math.floor(rnd() * 3);
    const lines = ['this ball has ' + rings + ' rings to escape', 'every bounce plays a note',
      'wait for it…', 'rate the escape 1 to 10'];
    return {
      title: 'can the ball escape? :skull:',
      rings: rings,
      timeline: timeline(lines.map(function (l) { return { text: l, dur: 4 }; }), 0.4),
      duration: 18
    };
  }

  function aura(rnd) {
    const items = some(rnd, AURA, 5).map(function (a) { return { text: a[0], points: a[1] }; });
    const tl = timeline(items.map(function (it) { return { text: it.text, dur: AURA_S }; }), 0.8);
    return {
      title: 'rating everything by aura :moai:',
      items: items,
      itemSeconds: AURA_S,
      start: 0.8,
      timeline: tl,
      duration: tl.end + 1.4
    };
  }

  function italian(rnd) {
    const who = pick(rnd, ITALIAN);
    const lines = [who.chant, who.chant, 'rate this one 1 to 10 :moai:'];
    return {
      title: who.name + ' :fire::fire:',
      character: who.id,
      name: who.name,
      timeline: timeline(lines.map(function (l) { return { text: l }; }), 0.8),
      duration: 15
    };
  }

  function dvd(rnd, v) {
    const lines = ['it has been bouncing for ' + v.num + ' hours', 'chat do NOT look away', 'wait for it…',
      'this is the most important video on the internet'];
    return {
      title: 'will it hit the corner? :sob:',
      word: pick(rnd, ['SKIBIDI', 'SIGMA', 'RIZZ', 'AURA', 'OHIO']),
      corner: 13, // seconds in: the closed-form path in reel.js lands in a corner then
      timeline: timeline(lines.map(function (l) { return { text: l, dur: 3.2 }; }), 0.4),
      duration: 16
    };
  }

  const MAKE = { story: story, bounce: bounce, aura: aura, italian: italian, dvd: dvd };

  // The n-th video of the feed started with `seed`.
  function video(seed, n) {
    const rnd = random((seed * 7919 + n * 104729) >>> 0);
    const kind = KINDS[((n % KINDS.length) + KINDS.length) % KINDS.length];
    const v = cast(rnd);
    const out = MAKE[kind](rnd, v);
    out.kind = kind;
    out.n = n;
    out.seed = Math.floor(rnd() * 4294967296);
    out.user = handle(rnd);
    out.tags = some(rnd, TAGS, 3).join(' ');
    out.likes = Math.floor(2000 + rnd() * 2400000);
    out.comments = Math.floor(out.likes * (0.004 + rnd() * 0.02));
    out.saves = Math.floor(out.likes * (0.02 + rnd() * 0.08));
    out.shares = Math.floor(out.likes * (0.01 + rnd() * 0.05));
    return out;
  }

  // A comment for the side panel: { user, text, likes }.
  function comment(rnd) {
    return {
      user: handle(rnd),
      text: fill(pick(rnd, COMMENTS), cast(rnd)),
      likes: Math.floor(Math.pow(rnd(), 3) * 90000)
    };
  }

  // 1234 -> '1234', 12345 -> '12.3K', 2400000 -> '2.4M', like the app.
  function count(n) {
    if (n < 10000) return String(n);
    if (n < 1000000) return (Math.floor(n / 100) / 10).toFixed(1).replace(/\.0$/, '') + 'K';
    return (Math.floor(n / 100000) / 10).toFixed(1).replace(/\.0$/, '') + 'M';
  }

  // The caption chunk showing at time t (or null between lines).
  function chunkAt(tl, t) {
    for (let i = 0; i < tl.chunks.length; i++) {
      const c = tl.chunks[i];
      if (t >= c.words[0].at && t < c.end) return { index: i, chunk: c };
    }
    return null;
  }

  CH.brainrot = {
    KINDS: KINDS,
    ITALIAN: ITALIAN,
    random: random,
    video: video,
    comment: comment,
    count: count,
    timeline: timeline,
    chunkAt: chunkAt
  };
})(typeof window !== 'undefined' ? window : globalThis);
