// Five real posts, as /api/x/eligible-posts gave them on 10 Nov 2026 (the default subject
// filter was on). They are public posts on X where readers asked for a Community Note. The
// timeline preview uses them, so that the mock needs no X call.

import type { XPost } from './types';

export const FIXTURE_FETCHED_AT_MS = Date.parse('2026-11-10T06:30:00.000Z');

export const FIXTURE_POSTS: XPost[] = [
  {
    "id": "2120014542000570602",
    "text": "Ja'Marr Chase, last 2 games:\n• 21 catches\n• 296 receiving yards\n• 2 receiving TDs\n\nJustin Jefferson, last 5 games:\n• 20 catches\n• 246 receiving yards\n• 2 receiving TDs",
    "createdAt": "2026-11-10T04:43:49.000Z",
    "lang": "en",
    "url": "https://x.com/MySportsUpdate/status/2120014542000570602",
    "author": {
      "id": "1312367672",
      "username": "MySportsUpdate",
      "name": "Ari Meirov",
      "avatarUrl": "https://pbs.twimg.com/profile_images/1486363097468129282/ghLus6Sx_normal.jpg",
      "verified": false
    },
    "media": [],
    "metrics": {
      "likes": 2593,
      "reposts": 82,
      "replies": 72,
      "views": 119613
    },
    "topic": "sport"
  },
  {
    "id": "2119918368736088126",
    "text": "The female scientist who found down syndrome had her work stolen by a male colleague for decades https://t.co/jlatZ6VprD",
    "createdAt": "2026-11-09T22:21:39.000Z",
    "lang": "en",
    "url": "https://x.com/Theveripost/status/2119918368736088126",
    "author": {
      "id": "2613782138",
      "username": "Theveripost",
      "name": "TVP",
      "avatarUrl": "https://pbs.twimg.com/profile_images/2038843755311378432/yuwI4nsz_normal.jpg",
      "verified": false
    },
    "media": [
      {
        "type": "photo",
        "url": "https://pbs.twimg.com/media/HWt2g7iX0AEaofX.jpg",
        "alt": null
      }
    ],
    "metrics": {
      "likes": 3073,
      "reposts": 454,
      "replies": 30,
      "views": 443903
    },
    "topic": "science"
  },
  {
    "id": "2119879956310512018",
    "text": "I've heard this from many folks at the game. The crowd was loud, atmosphere was great, but fake noise was noticeable. https://t.co/tOX9WRqZCr",
    "createdAt": "2026-11-09T19:49:01.000Z",
    "lang": "en",
    "url": "https://x.com/TJWalkerRadio/status/2119879956310512018",
    "author": {
      "id": "35892770",
      "username": "TJWalkerRadio",
      "name": "T.J. Walker",
      "avatarUrl": "https://pbs.twimg.com/profile_images/1986783108343971841/VIu8Zq6v_normal.jpg",
      "verified": false
    },
    "media": [],
    "metrics": {
      "likes": 560,
      "reposts": 27,
      "replies": 201,
      "views": 82896
    },
    "topic": "sport"
  },
  {
    "id": "2119872309796442122",
    "text": "GOOD RIDDANCE!!!\n\nJames Gunn FIRED - YES THIS IS REAL!!! (good riddance) https://t.co/giwi0kGwNQ via @YouTube",
    "createdAt": "2026-11-09T19:18:38.000Z",
    "lang": "en",
    "url": "https://x.com/TheresaCampagna/status/2119872309796442122",
    "author": {
      "id": "3316221969",
      "username": "TheresaCampagna",
      "name": "Jester_Bell 🎥 🍿 🥳",
      "avatarUrl": "https://pbs.twimg.com/profile_images/1984428831617531904/2pMDg2xO_normal.jpg",
      "verified": false
    },
    "media": [],
    "metrics": {
      "likes": 593,
      "reposts": 88,
      "replies": 97,
      "views": 129110
    },
    "topic": "entertainment"
  },
  {
    "id": "2119192900617510976",
    "text": "looked into this one:\n\nall 10 domains registered on namecheap on oct 13 + oct 19, ~$10 each\n\nthey do rank #1 for \"best data labs\", a phrase google doesn't even autocomplete\n\n\"best data labeling\" and \"best data brokers\", the ones people actually search -> not in the top 8\n\nexact match domains win zero-competition phrases. that's the whole trick 🫡",
    "createdAt": "2026-11-07T22:18:54.000Z",
    "lang": "en",
    "url": "https://x.com/consumerxai/status/2119192900617510976",
    "author": {
      "id": "1836285205088546816",
      "username": "consumerxai",
      "name": "An Nayal",
      "avatarUrl": "https://pbs.twimg.com/profile_images/2089378636725972992/Pi8RjRTZ_normal.jpg",
      "verified": false
    },
    "media": [],
    "metrics": {
      "likes": 150,
      "reposts": 5,
      "replies": 13,
      "views": 15783
    },
    "topic": "technology"
  }
];
