export default class Loop {
  constructor() {
    this.lastSegments = [];
  }

  getIndex({current, isNewPlaylist}) {
    if (isNewPlaylist) {
      this.lastSegments = [];
    }

    let numOccurrences =
      this.lastSegments.slice(-5).filter(val => val === current.index).length;

    if (numOccurrences > 2) {
      current = {
        rule: 'loop',
        index: -1
      };
    }

    this.lastSegments.push(current.index);

    return current;
  }
}
