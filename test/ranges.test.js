import Ranges from '../src/ranges';
import {createTimeRanges} from 'video.js';
import QUnit from 'qunit';

QUnit.module('TimeRanges Utilities');

QUnit.test('finds the overlapping time range', function() {
  let range = Ranges.findRange_(createTimeRanges([[0, 5], [6, 12]]), 3);

  QUnit.equal(range.length, 1, 'found one range');
  QUnit.equal(range.end(0), 5, 'inside the first buffered region');

  range = Ranges.findRange_(createTimeRanges([[0, 5], [6, 12]]), 6);
  QUnit.equal(range.length, 1, 'found one range');
  QUnit.equal(range.end(0), 12, 'inside the second buffered region');
});

QUnit.test('finds gaps in time ranges', function() {
  let gap;
  let timeRanges = createTimeRanges();

  // Nothing returned when no time ranges
  gap = Ranges.findGapWithTime(timeRanges, 0);
  QUnit.equal(gap.length, 0, 'empty time range');
  gap = Ranges.findGapWithTime(timeRanges, 1);
  QUnit.equal(gap.length, 0, 'empty time range');

  // Nothing returned when only one time range
  timeRanges = createTimeRanges([[1, 10]]);
  gap = Ranges.findGapWithTime(timeRanges, 0);
  QUnit.equal(gap.length, 0, 'empty time range');
  gap = Ranges.findGapWithTime(timeRanges, 5);
  QUnit.equal(gap.length, 0, 'empty time range');
  gap = Ranges.findGapWithTime(timeRanges, 11);
  QUnit.equal(gap.length, 0, 'empty time range');

  // Nothing returned when time is in a time range
  timeRanges = createTimeRanges([[5, 10], [15, 20]]);
  gap = Ranges.findGapWithTime(timeRanges, 5);
  QUnit.equal(gap.length, 0, 'empty time range');
  gap = Ranges.findGapWithTime(timeRanges, 7);
  QUnit.equal(gap.length, 0, 'empty time range');
  gap = Ranges.findGapWithTime(timeRanges, 20);
  QUnit.equal(gap.length, 0, 'empty time range');

  // Nothing returned when time is not between two time ranges
  gap = Ranges.findGapWithTime(timeRanges, 4);
  QUnit.equal(gap.length, 0, 'empty time range');
  gap = Ranges.findGapWithTime(timeRanges, 21);
  QUnit.equal(gap.length, 0, 'empty time range');

  // Returns gap when time is between two time ranges
  gap = Ranges.findGapWithTime(timeRanges, 11);
  QUnit.equal(gap.length, 1, 'returns time range gap');
  QUnit.equal(gap.start(0), 10, 'start is end of previous range');
  QUnit.equal(gap.end(0), 15, 'end is start of next range');
});

QUnit.module('Buffer Inpsection');

QUnit.test('detects time range end-point changed by updates', function() {
  let edge;

  // Single-range changes
  edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[0, 10]]),
                                               createTimeRanges([[0, 11]]));
  QUnit.strictEqual(edge, 11, 'detected a forward addition');

  edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[5, 10]]),
                                               createTimeRanges([[0, 10]]));
  QUnit.strictEqual(edge, null, 'ignores backward addition');

  edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[5, 10]]),
                                               createTimeRanges([[0, 11]]));
  QUnit.strictEqual(edge, 11,
                    'detected a forward addition & ignores a backward addition');

  edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[0, 10]]),
                                               createTimeRanges([[0, 9]]));
  QUnit.strictEqual(edge, null,
                    'ignores a backwards addition resulting from a shrinking range');

  edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[0, 10]]),
                                               createTimeRanges([[2, 7]]));
  QUnit.strictEqual(edge, null,
                    'ignores a forward & backwards addition resulting from a shrinking ' +
                    'range');

  edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[2, 10]]),
                                               createTimeRanges([[0, 7]]));
  QUnit.strictEqual(
    edge,
    null,
    'ignores a forward & backwards addition resulting from a range shifted backward'
  );

  edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[2, 10]]),
                                               createTimeRanges([[5, 15]]));
  QUnit.strictEqual(edge, 15,
                    'detected a forwards addition resulting from a range shifted foward');

  // Multiple-range changes
  edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[0, 10]]),
                                               createTimeRanges([[0, 11], [12, 15]]));
  QUnit.strictEqual(edge, null, 'ignores multiple new forward additions');

  edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[0, 10], [20, 40]]),
                                               createTimeRanges([[20, 50]]));
  QUnit.strictEqual(edge, 50, 'detected a forward addition & ignores range removal');

  edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[0, 10], [20, 40]]),
                                               createTimeRanges([[0, 50]]));
  QUnit.strictEqual(edge, 50, 'detected a forward addition & ignores merges');

  edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[0, 10], [20, 40]]),
                                               createTimeRanges([[0, 40]]));
  QUnit.strictEqual(edge, null, 'ignores merges');

  // Empty input
  edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges(),
                                               createTimeRanges([[0, 11]]));
  QUnit.strictEqual(edge, 11, 'handle an empty original TimeRanges object');

  edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[0, 11]]),
                                               createTimeRanges());
  QUnit.strictEqual(edge, null, 'handle an empty update TimeRanges object');

  // Null input
  edge = Ranges.findSoleUncommonTimeRangesEnd_(null,
                                               createTimeRanges([[0, 11]]));
  QUnit.strictEqual(edge, 11, 'treat null original buffer as an empty TimeRanges object');

  edge = Ranges.findSoleUncommonTimeRangesEnd_(createTimeRanges([[0, 11]]),
                                               null);
  QUnit.strictEqual(edge, null, 'treat null update buffer as an empty TimeRanges object');
});
