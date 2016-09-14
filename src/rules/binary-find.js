import {getMediaIndexForTime_} from '../playlist';

export default class BinaryFind {
  getIndex({current, expired, playlist, currentTime, buffered}) {
    if (current.index > -1) {
      return current;
    }

    if (buffered.length === 0) {
      return {
        rule: 'binary-find: no buffer',
        index: getMediaIndexForTime_(playlist, currentTime, expired)
      };
    }

    let closestIndex = 0;
    let closestDiff = Number.MAX_VALUE;

    for (let i = 0; i < buffered.length; i++) {
      let diff;

      if (buffered.end(i) < currentTime) {
        diff = currentTime - buffered.end(i);
      } else {
        diff = buffered.start(i) - currentTime;
      }

      if (diff < closestDiff) {
        closestDiff = diff;
        closestIndex = i;
      }
    }

    let closestStart = buffered.start(closestIndex);
    let closestEnd = buffered.end(closestIndex);

    if (closestEnd < currentTime) {
      return {
        rule: 'binary-find: current time exceeds closest found buffer end',
        index: getMediaIndexForTime_(
          playlist,
          closestEnd + (currentTime - closestEnd) / 2,
          expired)
      };
    }

    if (closestStart > currentTime) {
      return {
        rule: 'binary-find: current time less than closest found buffer start',
        index: getMediaIndexForTime_(
          playlist,
          currentTime + (closestStart - currentTime) / 2,
          expired)
      };
    }

    console.error('Should not get here!', buffered, playlist, currentTime, expired);
  }
}
