import {findRange} from '../ranges';

const indexForTime = (playlist, time, expired) => {
  let index = playlist.segments.findIndex((segment) => {
    return segment.timeInfo &&
      segment.timeInfo.video &&
      segment.timeInfo.video[0].dts <= time &&
      segment.timeInfo.video[1].dts >= time;
  });

  if (index === -1) {
    return getMediaIndexForTime_(playlist, time, expired);
  }
  return index;
}

export default class Pendulum {
  getIndex({index, playlist, buffered, currentTime, expired}) {
    let idx;

    if (idx < 0) {
      idx = indexForTime(playlist, time, expired);
    }

    let jump = 1;

    while (idx < playlist.segments.length && idx >= 0) {
      let segment = playlist.segments[idx];

      if (!segment.timeInfo) {
        return idx;
      }

      let midpoint = (segment.timeInfo.video[1].dts - segment.timeInfo.video[0].dts) / 2;

      if (!findRange(buffered, midpoint)) {
        return idx;
      }

      idx += jump;
      jump = -1 * (jump + 1);
    }

    return -1;
  }
}
