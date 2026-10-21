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
      'WIBTA if I left {place} because my {who} said “{phrase}”?',
      'AITA for bringing my {who} to {place} as my plus one?',
      'AITA for {verb} my {who} in front of the whole group chat?'
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
      'I said “{phrase}” and walked out.',
      'For context, they had been yapping about {stat} all week.',
      'Then they looked me dead in the eye and started mewing.',
      'Their aura went from 100 to negative in one sentence.',
      'Everyone at {place} saw it. EVERYONE.'
    ],
    close: ['So AITA? Or are they just {insult}?', 'Edit: they are mewing at me right now :skull:',
      'Update: we are both {insult} :sob:', 'Update: they changed the wifi password to “{phrase}”.']
  };

  // Texting stories: who sends each message, 'me' or 'them'.
  const CHATS = [
    { hook: 'texting my crush using only brainrot :skull:', contact: 'crush', lines: [
      ['me', 'hey pookie'], ['them', 'who is this'], ['me', 'the rizzler'], ['them', '??'],
      ['me', 'you’re the skibidi to my toilet'], ['them', 'blocked'], ['me', 'chat is this real'], ['them', '-1000 aura']] },
    { hook: 'texting my mom in gen alpha :sob:', contact: 'Mom', lines: [
      ['me', 'can you fanum tax me some fries'], ['them', 'what'], ['me', 'my aura is in the negatives'],
      ['them', 'are you feeling ok'], ['me', 'no cap fr fr'], ['them', 'where is your cap it’s 40 degrees out'],
      ['me', 'bro is cooked'], ['them', 'I AM YOUR MOTHER']] },
    { hook: 'asking my teacher for an extension :moai:', contact: 'Math teacher', lines: [
      ['me', 'can I get an extension'], ['them', 'reason?'], ['me', 'my mewing streak is on day {num}'],
      ['them', 'absolutely not'], ['me', 'that’s not very sigma of you'], ['them', 'see me after class'],
      ['me', 'erm what the sigma'], ['them', 'detention.']] },
    { hook: 'someone fanum taxed the group chat :fire:', contact: 'the sigmas (6)', lines: [
      ['them', 'who ate my fries'], ['me', 'not me'], ['them', 'your mewing face says otherwise'], ['me', 'skibidi'],
      ['them', 'bro is the Ohio final boss'], ['me', 'six seven'], ['them', 'i’m leaving'], ['me', 'W']] },
    { hook: 'texting my {who} at 3am :skull:', contact: '{who}', lines: [
      ['me', 'u up'], ['them', 'it’s 3am'], ['me', 'i just hit day {num} of mewing'], ['them', 'and?'],
      ['me', 'thought you should know'], ['them', 'goodnight'], ['me', 'aura check?'], ['them', 'negative']] }
  ];

  // Kinetic sand: band colours top to bottom.
  const SAND = [
    ['#F7A8C4', '#C3A6F2', '#8FD3F4', '#A8E6CF'],
    ['#FFD6A5', '#FDFFB6', '#CAFFBF', '#9BF6FF'],
    ['#FFADAD', '#FFC6FF', '#BDB2FF', '#A0C4FF'],
    ['#F9C74F', '#F9844A', '#F94144', '#90BE6D']
  ];

  const RACERS = [['RED', '#FF3B30'], ['BLUE', '#0A84FF'], ['GREEN', '#30D158'], ['YELLOW', '#FFD60A'],
    ['PURPLE', '#BF5AF2'], ['ORANGE', '#FF9F0A']];

  // Find the odd one out: lots of the first, one of the second.
  const ODD = [['O', 'Q'], ['6', '9'], ['b', 'd'], ['E', 'F'], ['8', 'B'], ['M', 'N'], ['5', 'S']];

  const SIGMA = ['never let them know your next move', 'if she says “k” you say “k.”', 'always mew in the group photo',
    'never reply in under three hours', 'eat the last nugget, then leave', 'walk away from every explosion',
    'sit at the back of the bus. alone.', 'never explain your aura', 'the grind does not stop for Ohio',
    'say six seven to no one in particular'];

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
    ['your mic was on the whole time', -3000],
    ['the automatic door didn’t open for you', -900],
    ['guessing the wifi password first try', 1800],
    ['clapping when the plane lands', -600],
    ['finding the odd one out in 2 seconds', 1000],
    ['typing “lol” with a straight face', -200],
    ['your mom liking your post', -1200]
  ];

  // Italian brainrot. Each `id` is a character reel.js knows how to draw.
  const ITALIAN = [
    { id: 'tung', name: 'Tung Tung Tung Sahur', chant: 'tung tung tung tung tung tung tung tung tung sahur' },
    { id: 'tralalero', name: 'Tralalero Tralala', chant: 'tralalero tralala, a shark with three pairs of sneakers' },
    { id: 'cappuccina', name: 'Ballerina Cappuccina', chant: 'ballerina cappuccina, mi mi mi mi mi' },
    { id: 'bananini', name: 'Chimpanzini Bananini', chant: 'chimpanzini bananini, wa wa wa wa' },
    { id: 'crocodilo', name: 'Bombardiro Crocodilo', chant: 'bombardiro crocodilo, flying over the cafeteria' },
    { id: 'patapim', name: 'Brr Brr Patapim', chant: 'brr brr patapim, brr brr patapim, a tree with big feet' },
    { id: 'assassino', name: 'Cappuccino Assassino', chant: 'cappuccino assassino, ta ta ta ta, two katanas' }
  ];

  const COMMENTS = [
    'the {ending} :sob:', 'W {stat}', 'bro is NOT him :skull:', 'who’s here in 2026?', 'first', 'chat is this real',
    'this is peak :fire:', 'not the {thing} :sob::sob:', 'i’m crying at 0:{num}', '{phrase} :moai:', 'mewing rn',
    'the aura on this one :fire:', 'POV: {place}', 'nah this is crazy', 'my brain is cooked', 'bro got fanum taxed',
    'this gave me {num} aura', 'L {who}', 'average {place} moment', 'ok but the {thing}?', 'six seven :skull:',
    'erm what the sigma', 'i need the sound', 'part 2 pls', 'algorithm brought me here', 'teacher said no phones :skull:',
    'the {who} is {insult} :skull:', 'replayed {num} times', 'GREEN ALWAYS WINS', 'found it in 2 seconds',
    'the sand cut :sob::sob:', 'bro texted his mom :skull:', 'sigma rule #1: never comment', 'not the parkour :fire:',
    'i put RED and lost my aura', 'the knife sound :sob:', 'this is my roman empire'
  ];

  // Order of video kinds down the feed; the split screens come round twice.
  const KINDS = ['story', 'bounce', 'texting', 'aura', 'italian', 'sand', 'odd', 'story', 'race', 'sigma',
    'texting', 'dvd'];

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
  // Each line runs `dur` seconds (default: its words at WORD_S each); a line
  // with no words is a pause of `dur`.
  // Returns { chunks: [{ words: [{ text, at }], end }], end }.
  function timeline(lines, start) {
    const chunks = [];
    let at = start || 0;
    lines.forEach(function (line) {
      const words = String(line.text).split(/\s+/).filter(Boolean);
      if (!words.length) {
        at += line.dur || 0;
        return;
      }
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

  // A chat that plays out over parkour: messages arrive one by one, the
  // other side 'typing…' first.
  function texting(rnd, v) {
    const chat = pick(rnd, CHATS);
    const messages = [];
    let at = 3.2;
    chat.lines.forEach(function (line) {
      const text = fill(line[1], v);
      if (line[0] === 'them') at += 0.9; // time to type
      messages.push({ from: line[0], text: text, at: at });
      at += 1.1 + text.length * 0.035;
    });
    return {
      title: fill(chat.hook, v),
      contact: fill(chat.contact, v),
      messages: messages,
      timeline: timeline([{ text: fill(chat.hook, v), dur: 2.6 }], 0.3),
      duration: at + 2
    };
  }

  function sand(rnd) {
    const lines = ['turn your sound on', 'kinetic sand cutting', 'the last cut is so satisfying', 'which slice was the best?'];
    return {
      title: 'kinetic sand ASMR :fire:',
      colours: pick(rnd, SAND),
      cut: 1.6, // seconds per slice
      timeline: timeline(lines.map(function (l) { return { text: l, dur: 3.4 }; }), 0.4),
      duration: 16
    };
  }

  function race(rnd) {
    const lines = ['comment your color', 'which one wins?'];
    return {
      title: 'which color wins? :fire:',
      racers: RACERS.map(function (r) { return { name: r[0], colour: r[1] }; }),
      timeline: timeline(lines.map(function (l) { return { text: l, dur: 3 }; }), 0.4),
      duration: 17
    };
  }

  function odd(rnd) {
    const pair = pick(rnd, ODD);
    const cols = 7;
    const rows = 9;
    const lines = [{ text: 'only 1% can find the odd one out', dur: 3 }, { text: 'you have 10 seconds', dur: 2.6 },
      { text: '', dur: 6.4 }, { text: 'did you find it? :skull:', dur: 3 }];
    return {
      title: 'only 1% can find it :skull:',
      pair: pair,
      cols: cols,
      rows: rows,
      odd: Math.floor(rnd() * cols * rows),
      start: 1.5, // the countdown runs from here for ten seconds
      timeline: timeline(lines, 0.3),
      duration: 16
    };
  }

  function sigma(rnd) {
    const rule = pick(rnd, SIGMA);
    const n = 1 + Math.floor(rnd() * 99);
    const lines = [{ text: '', dur: 1.6 }, { text: rule, dur: Math.max(4, rule.split(' ').length * 0.6) }];
    return {
      title: 'sigma rule #' + n + ' :moai:',
      rule: n,
      timeline: timeline(lines, 0.4),
      duration: 13
    };
  }

  const MAKE = { story: story, bounce: bounce, aura: aura, italian: italian, dvd: dvd, texting: texting, sand: sand,
    race: race, odd: odd, sigma: sigma };

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
