import videojs from 'video.js';
import sinon from 'sinon';
import {MediaSource} from 'videojs-contrib-media-sources';

// a SourceBuffer that tracks updates but otherwise is a noop
const MockSourceBuffer = videojs.extend(videojs.EventTarget, {
  constructor() {
    this.updates_ = [];

    this.on('updateend', function() {
      this.updating = false;
    });
    this.buffered = videojs.createTimeRanges();

    this.duration_ = NaN;
    Object.defineProperty(this, 'duration', {
      get() {
        return this.duration_;
      },
      set(duration) {
        this.updates_.push({
          duration
        });
        this.duration_ = duration;
        this.updating = true;
      }
    });
  },
  appendBuffer(bytes) {
    this.updates_.push({
      append: bytes
    });
    this.updating = true;
  },
  remove(start, end) {
    this.updates_.push({
      remove: [start, end]
    });
    this.updating = true;
  },

  updating: false
});

export const MockMediaSource = function() {
  let mediaSource = new MediaSource();
  mediaSource.addSourceBuffer = function(mime) {
    let sourceBuffer = new MockSourceBuffer();

    sourceBuffer.mimeType_ = mime;
    mediaSource.sourceBuffers.push(sourceBuffer);
    return sourceBuffer;
  };
  return mediaSource;
};

let clock;
let xhr;
let requests;

const restoreEnvironment = function() {
  clock.restore();
  videojs.xhr.XMLHttpRequest = window.XMLHttpRequest;
  xhr.restore();
};

export const useFakeEnvironment = function() {
  clock = sinon.useFakeTimers();
  xhr = sinon.useFakeXMLHttpRequest();
  videojs.xhr.XMLHttpRequest = xhr;
  requests = [];
  xhr.onCreate = function(xhr) {
    requests.push(xhr);
  };
  return {
    clock,
    requests,
    restore: restoreEnvironment
  };
};
