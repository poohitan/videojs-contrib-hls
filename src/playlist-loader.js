/**
 * playlist-loader
 *
 * A state machine that manages the loading, caching, and updating of
 * M3U8 playlists.
 *
 */
import resolveUrl from './resolve-url';
import XhrModule from './xhr';
import {mergeOptions} from 'video.js';
import Stream from './stream';
import m3u8 from './m3u8';

const DEFAULT_REFRESH_SECONDS = 10;

// TODO - need?
/**
  * Returns a new array of segments that is the result of merging
  * properties from an older list of segments onto an updated
  * list. No properties on the updated playlist will be overridden.
  * @param original {array} the outdated list of segments
  * @param update {array} the updated list of segments
  * @param offset {number} (optional) the index of the first update
  * segment in the original segment list. For non-live playlists,
  * this should always be zero and does not need to be
  * specified. For live playlists, it should be the difference
  * between the media sequence numbers in the original and updated
  * playlists.
  * @return a list of merged segment objects
  */
const updateSegments = function(original, update, offset) {
  let result = update.slice();
  let length;
  let i;

  offset = offset || 0;
  length = Math.min(original.length, update.length + offset);

  for (i = offset; i < length; i++) {
    result[i - offset] = mergeOptions(original[i], result[i - offset]);
  }
  return result;
};

// TODO - need?
/**
  * Returns a new master playlist that is the result of merging an
  * updated media playlist into the original version. If the
  * updated media playlist does not match any of the playlist
  * entries in the original master playlist, null is returned.
  * @param master {object} a parsed master M3U8 object
  * @param media {object} a parsed media M3U8 object
  * @return {object} a new object that represents the original
  * master playlist with the updated media playlist merged in, or
  * null if the merge produced no change.
  */
const updateMaster = function(master, media) {
  let changed = false;
  let result = mergeOptions(master, {});
  let i = master.playlists.length;
  let playlist;
  let segment;
  let j;

  while (i--) {
    playlist = result.playlists[i];
    if (playlist.uri === media.uri) {
      // consider the playlist unchanged if the number of segments
      // are equal and the media sequence number is unchanged
      if (playlist.segments &&
          media.segments &&
          playlist.segments.length === media.segments.length &&
          playlist.mediaSequence === media.mediaSequence) {
        continue;
      }

      result.playlists[i] = mergeOptions(playlist, media);
      result.playlists[media.uri] = result.playlists[i];

      // if the update could overlap existing segment information,
      // merge the two lists
      if (playlist.segments) {
        result.playlists[i].segments = updateSegments(
          playlist.segments,
          media.segments,
          media.mediaSequence - playlist.mediaSequence
        );
      }
      // resolve any missing segment and key URIs
      j = 0;
      if (result.playlists[i].segments) {
        j = result.playlists[i].segments.length;
      }
      while (j--) {
        segment = result.playlists[i].segments[j];
        if (!segment.resolvedUri) {
          segment.resolvedUri = resolveUrl(playlist.resolvedUri, segment.uri);
        }
        if (segment.key && !segment.key.resolvedUri) {
          segment.key.resolvedUri = resolveUrl(playlist.resolvedUri, segment.key.uri);
        }
      }
      changed = true;
    }
  }
  return changed ? result : null;
};

export class PlaylistLoader extends Stream {
  constructor(url, withCredentials, initMetadataRequest) {
    super();

    this.error;
    this.playlist;
    // track the time that has expired from the live window
    // this allows the seekable start range to be calculated even if
    // all segments with timing information have expired
    this.expired = 0;

    this.url = url;
    this.withCredentials_ = withCredentials;
    this.request_;
    this.bandwidth_;
    this.updateTimeout_;
    this.initMetadataRequest_ = initMetadataRequest;
    this.lastResponseTime_ = this.initMetadataRequest_ ? new Date() : 0;

    if (!this.url) {
      throw new Error('A non-empty playlist URL is required');
    }
  }

  /**
    * Abort any outstanding work and clean up.
    */
  dispose() {
    super.dispose();

    this.abortRequest_();
    window.clearTimeout(this.updateTimeout_);
  }

  load() {
    // if we were given the inital request, try using it
    if (this.initMetadataRequest_) {
      this.haveMetadata_(this.initMetadataRequest_);
      this.initMetadataRequest_ = null;
    }

    if (this.playlist && this.playlist.endList) {
      return this.trigger('loaded');
    }

    if (this.playlist &&
        (new Date() - this.lastResponseTime_ < DEFAULT_REFRESH_SECONDS)) {
      // playlist is fresh enough
      this.trigger('loaded');
      this.startRefresh_();
      return;
    }

    this.request_ = XhrModule({
      uri: this.url,
      withCredentials: this.withCredentials_
    }, (error, req) => {
      if (error) {
        return this.playlistRequestError_(this.request_);
      }

      this.haveMetadata_(this.request_);
      this.trigger('loaded');
      this.startRefresh_();
    });
  }

  stop() {
    this.abortRequest_();
    window.clearTimeout(this.updateTimeout_);
  }

  abortRequest_() {
    if (this.request_) {
      this.request_.onreadystatechange = null;
      this.request_.abort();
      this.request_ = null;
    }
  }

  setBandwidth_(xhr) {
    this.bandwidth_ = xhr.bandwidth;
  }

  playlistRequestError_(xhr) {
    this.setBandwidth_(this.request_ || xhr);

    // any in-flight request is now finished
    this.request_ = null;

    this.error = {
      status: xhr.status,
      message: 'HLS playlist request error at URL: ' + this.url,
      responseText: xhr.responseText,
      code: (xhr.status >= 500) ? 4 : 2
    };

    this.trigger('error');
  }

  refreshDelay_() {
    if (!this.playlist) {
      return DEFAULT_REFRESH_SECONDS * 1000;
    }
    return (this.playlist.targetDuration || DEFAULT_REFRESH_SECONDS) * 1000;
  }

  haveMetadata_(xhr) {
    let origPlaylist = this.playlist_;
    let parser = new m3u8.Parser();

    this.lastResponseTime_ = new Date();
    this.setBandwidth_(this.request_ || xhr);

    // any in-flight request is now finished
    this.request_ = null;

    parser.push(xhr.responseText);
    parser.end();
    parser.manifest.uri = url;

    this.playlist = parser.manifest;

    if (!this.playlist.endList) {
      this.updatePlaylist_(origPlaylist);
    }

    // TODO - deepEqual implementation
    if (deepEqual(origPlaylist, this.playlist)) {
      return false;
    }
    return true;
  }

  startRefresh_() {
    // VOD playlists should not change
    if (this.playlist.endList) {
      return;
    }

    window.clearTimeout(this.updateTimeout_);
    this.updateTimeout_ = window.setTimeout(this.refresh_.bind(this),
                                            this.refreshDelay_());
  }

  refresh_() {
    this.request_ = XhrModule({
      uri: this.url,
      withCredentials: this.withCredentials_
    }, (error, req) => {
      let refreshDelay = this.refreshDelay_();

      if (error) {
        return this.playlistRequestError_(this.request_);
      }

      if (!this.haveMetadata_(this.request_)) {
        // playlist was unchanged, try again in half time
        refreshDelay /= 2
      } else {
        this.trigger('refresh');
      }

      this.updateTimeout_ = window.setTimeout(this.refresh_.bind(this), refreshDelay);
    });
  }

  /**
    * Update the PlaylistLoader state to reflect the changes in an
    * update to the current media playlist.
    * @param origPlaylist {object} the old media playlist object
    */
  updatePlaylist_(origPlaylist) {
    let i;
    let segment;

    if (!origPlaylist) {
      return;
    }

    // try using precise timing from first segment of the updated
    // playlist
    if (this.playlist.segments.length) {
      if (typeof this.playlist.segments[0].start !== 'undefined') {
        this.expired = this.playlist.segments[0].start;
        return;
      } else if (typeof this.playlist.segments[0].end !== 'undefined') {
        this.expired = this.playlist.segments[0].end - this.playlist.segments[0].duration;
        return;
      }
    }

    // calculate expired by walking the outdated playlist
    i = this.playlist.mediaSequence - origPlaylist.mediaSequence - 1;

    for (; i >= 0; i--) {
      segment = origPlaylist.segments[i];

      if (!segment) {
        // we missed information on this segment completely between
        // playlist updates so we'll have to take an educated guess
        // once we begin buffering again, any error we introduce can
        // be corrected
        this.expired += origPlaylist.targetDuration || 10;
        continue;
      }

      if (typeof segment.end !== 'undefined') {
        this.expired = segment.end;
        return;
      }
      if (typeof segment.start !== 'undefined') {
        this.expired = segment.start + segment.duration;
        return;
      }
      this.expired += segment.duration;
    }
  }
};

export const getPlaylistLoadersForManifest = (manifestUrl, withCredentials, callback) => {
  if (!manifestUrl) {
    throw new Error('A non-empty manifest URL is required');
  }

  XhrModule({
    uri: manifestUrl,
    withCredentials
  }, (error, req) => {
    let parser = new m3u8.Parser();

    if (error) {
      return callback({
        status: req.status,
        message: 'HLS manifest request error at URL: ' + manifestUrl,
        responseText: req.responseText,
        // MEDIA_ERR_NETWORK
        code: 2
      });
    }

    parser.push(req.responseText);
    parser.end();

    // manifest was a master playlist
    if (parser.manifest.playlists) {
      callback(null, Array.from(parser.master.playlists, (playlist) => {
        return new PlaylistLoader(resolveUrl(manifestUrl, playlist), withCredentials));
      });
    }

    // manifest was a media playlist
    callback(null, [new PlaylistLoader(manifestUrl, withCredentials, req)]);
  });
};
