import window from 'global/window';
import videojs from 'video.js';
import SourceUpdater from './source-updater';
import Config from './config';
import {inspect as inspectSegment} from 'mux.js/lib/tools/ts-inspector.js';
import Ranges from './ranges';
import {getMediaIndexForTime_, duration} from './playlist';
import BinaryFind from './rules/binary-find';
import MediaIndexPlusPlus from './rules/media-index-plus-plus';
import Loop from './rules/loop';

const LIVE_RULES = [MediaIndexPlusPlus, BinaryFind, Loop];

// milliseconds
const GET_SOME_VIDEO_DELAY = 500;

const abortXhr = (xhr) => {
  if (!xhr) {
    return;
  }

  // Prevent error handler from running.
  xhr.onreadystatechange = null;
  xhr.abort();
};

/**
 * Turns segment byterange into a string suitable for use in
 * HTTP Range requests
 */
const byterangeStr = function(byterange) {
  let byterangeStart;
  let byterangeEnd;

  // `byterangeEnd` is one less than `offset + length` because the HTTP range
  // header uses inclusive ranges
  byterangeEnd = byterange.offset + byterange.length - 1;
  byterangeStart = byterange.offset;
  return 'bytes=' + byterangeStart + '-' + byterangeEnd;
};

/**
 * Defines headers for use in the xhr request for a particular segment.
 */
const segmentXhrHeaders = function(segment) {
  let headers = {};

  if ('byterange' in segment) {
    headers.Range = byterangeStr(segment.byterange);
  }
  return headers;
};

export default class NewSegmentLoader extends videojs.EventTarget {
  constructor({mediaSource, currentTime, bandwidth, hls, mimeType, setCurrentTime}) {
    super();

    // TODO bandwidth and tracking

    this.currentTime_ = currentTime;
    this.setCurrentTime_ = setCurrentTime;
    this.mediaSource_ = mediaSource;
    this.xhr_ = hls.xhr;

    // start paused
    this.pause();

    this.rules = LIVE_RULES.map(rule => new rule());

    this.getSomeVideoInterval = window.setInterval(
      this.getSomeVideo.bind(this), GET_SOME_VIDEO_DELAY);
  }

  mimeType(mimeType) {
    this.sourceUpdater_ = new SourceUpdater(this.mediaSource_, mimeType);
    this.clearEverything();
    this.getSomeVideo();
  }

  playlist(playlist, xhrOptions) {
    let newPlaylist = this.playlist !== playlist;

    this.playlist_ = playlist;
    this.xhrOptions_ = xhrOptions;

    if (newPlaylist) {
      this.newPlaylist_ = true;

      if (this.sourceUpdater_ && !Ranges.findRange(this.buffered(), this.currentTime_())) {
        this.setCurrentTime_(duration(this.playlist_.segments.length - 3));
      }
    }
  }

  seek() {
    this.clearEverything();
    this.seek_ = true;
  }

  expired(expiredTime) {
    this.expired_ = expiredTime;
  }

  pause() {
    this.paused_ = true;
    this.clearEverything();
  }

  resume() {
    this.paused_ = false;
  }

  clearEverything() {
    this.alreadyGettingSomeVideo_ = false;
    abortXhr(this.keyXhr_);
    abortXhr(this.segmentXhr_);
    this.segmentInfo_ = null;
  }

  /**
   * set an error on the segment loader
   *
   * @param {Error} error the error to set on the SegmentLoader
   * @return {Error} the error that was set or that is currently set
   */
  error(error) {
    if (error) {
      this.error_ = error;
    }
    return this.error_;
  }

  buffered() {
    return this.sourceUpdater_.buffered();
  }

  plentyOfBuffer() {
    let buffered = this.buffered();
    let endOfBuffer = buffered.length ? buffered.end(buffered.length - 1) : 0;
    let currentTime = this.currentTime_();

    if (currentTime > endOfBuffer) {
      return false;
    }

    let currentBuffered = Ranges.findRange(buffered, currentTime);

    if (currentBuffered.length === 0) {
      return false;
    }

    return currentBuffered.end(0) - currentTime >= Config.GOAL_BUFFER_LENGTH;
  }

  getSomeVideo() {
    if (this.paused_ ||
        this.alreadyGettingSomeVideo_ ||
        !this.sourceUpdater_ ||
        !this.playlist_ ||
        !this.playlist_.segments.length ||
        this.plentyOfBuffer()) {
      console.log({
        paused: this.paused_,
        already: this.alreadyGettingSomeVideo_,
        source: this.sourceUpdater_,
        playlist: this.playlist_,
      });
      return;
    }

    this.alreadyGettingSomeVideo_ = true;

    let isNewPlaylist = this.newPlaylist_;
    let current = {
      rule: 'none',
      index: -1
    };

    if (Ranges.findRange(this.buffered(), this.currentTime_()).length > 0) {
      this.newPlaylist_ = false;
      this.seek_ = false;
    }

    console.log({
      playlist: this.playlist_,
      currentTime: this.currentTime_(),
      buffered: this.buffered(),
      expired: this.expired_,
      isSeeking: this.seek_,
      isNewPlaylist: this.newPlaylist_,
      current
    });
    this.rules.forEach((rule) => {
      current = rule.getIndex({
        playlist: this.playlist_,
        currentTime: this.currentTime_(),
        buffered: this.buffered(),
        expired: this.expired_,
        isSeeking: this.seek_,
        isNewPlaylist: this.newPlaylist_,
        current
      });
    });

    console.log(current.rule, current.index);

    let mediaIndex = current.index;

    if (mediaIndex < 0 || mediaIndex > this.playlist_.segments.length - 1) {
      return;
    }

    let segment = this.playlist_.segments[mediaIndex];

    this.requestSegment({
      segment,
      mediaIndex,
      playlist: this.playlist_,
    });
  }

  requestSegment(segmentInfo) {
    if (segmentInfo.segment.key) {
      let keyRequestOptions = videojs.mergeOptions(this.xhrOptions_, {
        uri: segmentInfo.segment.key.resolvedUri,
        responseType: 'arraybuffer'
      });

      this.keyXhr_ = this.xhr_(keyRequestOptions, this.handleResponse.bind(this));
    }

    let segmentRequestOptions = videojs.mergeOptions(this.xhrOptions_, {
      uri: segmentInfo.segment.resolvedUri,
      responseType: 'arraybuffer',
      headers: segmentXhrHeaders(segmentInfo.segment)
    });

    this.segmentXhr_ = this.xhr_(segmentRequestOptions, this.handleResponse.bind(this));

    this.segmentInfo_ = segmentInfo;
  }

  handleResponse(err, request) {
    if (!this.segmentXhr_ ||
        (request !== this.segmentXhr_ && request !== this.keyXhr_) ||
        this.paused_) {
      return;
    }

    // if a request times out, reset bandwidth tracking
    if (request.timedout) {
      this.clearEverything();
      this.trigger('progress');
      return;
    }

    // trigger an event for other errors
    if (!request.aborted && err) {
      // this.pause();
      this.error({
        status: request.status,
        message: request === this.keyXhr_ ?
          'HLS key request error at URL: ' + this.segmentInfo_.segment.key.resolvedUri :
          'HLS segment request error at URL: ' + this.segmentInfo_.segment.resolvedUri,
        code: 2,
        xhr: request,
        err: err
      });
      this.trigger('error');
      return;
    }

    // stop processing if the request was aborted
    if (!request.response) {
      this.clearEverything();
      return;
    }

    if (request === this.segmentXhr_) {
      // the segment request is no longer outstanding
      this.segmentXhr_ = null;

      // calculate the download bandwidth based on segment request
      this.roundTrip = request.roundTripTime;
      this.bandwidth = request.bandwidth;
      this.mediaBytesTransferred += request.bytesReceived || 0;
      this.mediaRequests += 1;
      this.mediaTransferDuration += request.roundTripTime || 0;

      let encrypted = this.segmentInfo_.segment.key;

      this.segmentInfo_[encrypted ? 'encryptedBytes' : 'bytes'] =
        new Uint8Array(request.response);
    }

    if (request === this.keyXhr_) {
      keyXhrRequest = this.xhr_.segmentXhr;
      // the key request is no longer outstanding
      this.xhr_.keyXhr = null;

      if (request.response.byteLength !== 16) {
        this.abort_();
        this.error({
          status: request.status,
          message: 'Invalid HLS key at URL: ' + this.segmentInfo_.segment.key.uri,
          code: 2,
          xhr: request
        });
        this.state = 'READY';
        // this.pause();
        return this.trigger('error');
      }

      view = new DataView(request.response);
      this.segmentInfo_.segment.key.bytes = new Uint32Array([
        view.getUint32(0),
        view.getUint32(4),
        view.getUint32(8),
        view.getUint32(12)
      ]);

      // if the media sequence is greater than 2^32, the IV will be incorrect
      // assuming 10s segments, that would be about 1300 years
      this.segmentInfo_.segment.key.iv = this.segmentInfo_.segment.key.iv ||
        new Uint32Array([
          0,
          0,
          0,
          this.segmentInfo_.mediaIndex + this.segmentInfo_.playlist.mediaSequence
        ]);
    }

    if (!this.segmentXhr_ && !this.keyXhr_) {
      this.processResponse(this.segmentInfo_);
    }
  }

  processResponse(segmentInfo) {
    if (segmentInfo.segment.key) {
      let decryptedSegmentInfo = segmentInfo;

      // this is an encrypted segment
      // incrementally decrypt the segment
      /* eslint-disable no-new, handle-callback-err */
      new Decrypter(
        segmentInfo.encryptedBytes, segmentInfo.segment.key.bytes,
        segmentInfo.segment.key.iv, (err, bytes) => {
        // err always null

        if (this.segmentInfo_ !== decryptedSegmentInfo) {
          return;
        }

        segmentInfo.bytes = bytes;
        this.appendSegment(segmentInfo);
      });
      /* eslint-enable */
    } else {
      this.appendSegment(segmentInfo);
    }
  }

  // TODO remove and instead use baseMediaDecodeTime and duration

  updateTimestampOffset(segment) {
    if (this.playlist_ !== this.bufferPlaylist_ ||
        this.playlist_.discontinuityStarts[segment.uri]) {
      console.log('Setting timestamp offset to: ' + segment.timeInfo.video[0].dts);
      this.sourceUpdater_.timestampOffset(segment.timeInfo.video[0].dts);
      this.bufferPlaylist_ = this.playlist_;
    }
  }

  appendSegment(segmentInfo) {
    let timeInfo = inspectSegment(segmentInfo.bytes, this.inspectCache_);

    if (timeInfo.video && timeInfo.video.length === 2) {
      this.inspectCache_ = timeInfo.video[1].dts;
    } else if (timeInfo.audio && timeInfo.audio.length === 2) {
      this.inspectCache_ = timeInfo.audio[1].dts;
    }

    segmentInfo.segment.timeInfo = timeInfo;

    console.log(timeInfo);

    this.updateTimestampOffset(segmentInfo.segment);

    this.sourceUpdater_.appendBuffer(segmentInfo.bytes, () => {
      this.trigger('progress');

      this.updateTimeline(segmentInfo);

      // TODO check end of stream

      this.alreadyGettingSomeVideo_ = false;

      this.getSomeVideo();
    });
  }

  destroy() {
    this.clearEverything();
    window.clearInterval(this.getSomeVideoInterval);
  }

  /**
   * annotate the segment with any start and end time information
   * added by the media processing
   *
   * @private
   * @param {Object} segmentInfo annotate a segment with time info
   */
  updateTimeline(segmentInfo) {
    let segmentEnd;
    let timelineUpdated = false;
    let playlist = segmentInfo.playlist;

    let segment = playlist.segments[segmentInfo.mediaIndex];

    // Update segment meta-data (duration and end-point) based on timeline
    if (segment &&
        segmentInfo &&
        segmentInfo.playlist.uri === this.playlist_.uri) {
      segmentEnd = Ranges.findSoleUncommonTimeRangesEnd(segmentInfo.buffered,
                                                        this.sourceUpdater_.buffered());
      timelineUpdated = updateSegmentMetadata(playlist,
                                              segmentInfo.mediaIndex,
                                              segmentEnd);
    }

    return timelineUpdated;
  }
}

/**
 * Updates segment with information about its end-point in time and, optionally,
 * the segment duration if we have enough information to determine a segment duration
 * accurately.
 *
 * @param {Object} playlist a media playlist object
 * @param {Number} segmentIndex the index of segment we last appended
 * @param {Number} segmentEnd the known of the segment referenced by segmentIndex
 */
const updateSegmentMetadata = function(playlist, segmentIndex, segmentEnd) {
  if (!playlist) {
    return false;
  }

  let segment = playlist.segments[segmentIndex];
  let previousSegment = playlist.segments[segmentIndex - 1];

  if (segmentEnd && segment) {
    segment.end = segmentEnd;

    // fix up segment durations based on segment end data
    if (!previousSegment) {
      // first segment is always has a start time of 0 making its duration
      // equal to the segment end
      segment.duration = segment.end;
    } else if (previousSegment.end) {
      segment.duration = segment.end - previousSegment.end;
    }
    return true;
  }
  return false;
};
