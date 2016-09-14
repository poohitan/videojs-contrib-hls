export default class MediaIndexPlusPlus {
  constructor() {
    this.lastIndex = -1;
  }

  getIndex({current, isSeeking, isNewPlaylist}) {
    if (isSeeking && isNewPlaylist) {
      return current;
    }
    return {
      rule: 'media-index-plus-plus',
      index: ++this.lastIndex
    };
  }
}
