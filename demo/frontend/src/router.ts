// The notes app lives in the Speak-to-Sign page, under the hash #/notes. It has one view: the
// timeline of the demo post and the posts from X that can get a note. A post has no page of its
// own: a click on it opens its bet dialog or the write dialog over the timeline. Any hash shows
// the timeline, so an old link to a post (#/notes/post/<id>) still lands there.

export const paths = {
  home: '#/notes',
  timeline: '#/notes/timeline',
};
