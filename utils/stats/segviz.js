const VIZ_HEIGHT = 250;
const VIZ_WIDTH = 600;
const SEG_WIDTH = 200;

class ActionStore extends videojs.EventTarget {
  constructor() {
    super();
    this.actions = [];
  }

  addAction(action) {
    this.actions.push(action);
    this.trigger('action');
  }
}

class DiscontinuityViz {
  constructor() {
    this.el = document.createElement('div');
    this.el.style.position = 'relative';
    this.el.innerHTML = '...';
  }
}

class SegmentViz {
  constructor(data) {
    this.el = document.createElement('div');
    this.el.style.position = 'relative';

    this.el.innerHTML = `
      <p><strong>hls</strong></p>
      <ul>
        <li>duration: ${data.manifest.duration}</li>
        <li>start: ${data.manifest.start}</li>
        <li>end: ${data.manifest.end}</li>
      </ul>
      <p><strong>muxer</strong></p>
      <ul>
        <li>baseMediaDecodeTime: ${data.muxer.baseMediaDecodeTime}</li>
        <li>timelineStartPts: ${data.muxer.timlineStartPts}</li>
        <li>pts: ${data.muxer.pts.min}</li>
        <li>dts: ${data.muxer.dts.min}</li>
      </ul>
    `;
  }
}

class Viz {
  constructor(name, actionStore) {
    this.name = name;
    this.actionStore = actionStore;

    this.el = document.createElement('div');
    this.el.className = 'viz';
    this.el.style.height = VIZ_HEIGHT + 'px';
    this.el.style.width = VIZ_WIDTH + 'px';
    this.drawX = 0;

    let titleDiv = document.createElement('div');
    titleDiv.width = '100px';
    this.drawX += 100;
    // cheap vertical center
    titleDiv.style.lineHeight = VIZ_HEIGHT + 'px';
    titleDiv.innerHTML = name;
    this.el.appendChild(titleDiv);

    this.actionStore.on('action', this.addAction.bind(this));
  }

  addAction() {
    let action = this.actionStore.actions[this.actionStore.actions.length - 1];
    let actionContainer = this.actionContainer();
    let viz;

    if (action.type === 'segment') {
      viz = new SegmentViz(action.data);
    } else if (action.type === 'discontinuity') {
      viz = new DiscontinuityViz();
    }

    actionContainer.appendChild(viz.el);
  }

  actionContainer() {
    let container = document.createElement('div');

    container.style.height = VIZ_HEIGHT + 'px';
    container.style.width = SEG_WIDTH + 'px';
    container.style.position = 'absolute';
    container.style.left = this.drawX + 'px';
    container.style.top = '0px';

    this.el.appendChild(container);
    this.drawX += SEG_WIDTH;

    return container;
  }
}

class Watcher {
  constructor(segmentLoader, name) {
    this.segmentLoader = segmentLoader;
    this.sourceBuffer = this.segmentLoader.sourceUpdater_.sourceBuffer_;
    this.actionStore = new ActionStore();
    this.viz = new Viz(name, this.actionStore);

    this.segmentLoader.on('discontinuity', () => {
      this.actionStore.addAction({
        type: 'discontinuity'
      });
    });

    this.segmentLoader.on('appending', () => {
      let segmentInfo = this.segmentLoader.pendingSegment_;
      let segment = segmentInfo.playlist.segments[segmentInfo.mediaIndex];

      this.sourceBuffer.one('segmentinfo', () => {
        let muxerInfo = this.sourceBuffer.lastSegmentInfo_;
        let track = muxerInfo.tracks[0];

        console.log(muxerInfo);

        this.actionStore.addAction({
          type: 'segment',
          data: {
            manifest: {
              duration: segment.duration,
              start: segmentInfo.startOfSegment,
              end: segmentInfo.startOfSegment + segment.duration,
              mediaIndex: segmentInfo.mediaIndex,
              uri: segmentInfo.uri
            },
            muxer: {
              duration: null,
              pts: {
                min: track.timelineStartInfo.pts,
                max: null
              },
              dts: {
                min: track.timelineStartInfo.dts,
                max: null
              },
              timlineStartPts: muxerInfo.info.timelineStartPts,
              baseMediaDecodeTime: track.timelineStartInfo.baseMediaDecodeTime,
              edits: {}
            }
          }
        });
      });
    });
  }

  getEl() {
    return this.viz.el;
  }
}

let segviz = (player) => {
  let el = document.createElement('div');
  el.id = 'segviz';
  el.style.width = player.width();
  el.style.height = '0px';
  player.el_.parentNode.parentNode.insertBefore(el, player.el_.parentNode);

  let mpc = player.tech_.hls.masterPlaylistController_;

  let videoWatcher = new Watcher(mpc.mainSegmentLoader_, 'video');
  el.style.height = (parseInt(el.style.height) + VIZ_HEIGHT) + 'px';
  el.appendChild(videoWatcher.getEl());

  if (mpc.audioSegmentLoader_.sourceUpdater_) {
    let audioWatcher = new Watcher(mpc.audioSegmentLoader_, 'audio');
    el.style.height = (parseInt(el.style.height) + VIZ_HEIGHT) + 'px';
    el.appendChild(audioWatcher.getEl());
  }
};
