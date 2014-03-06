var assert = require('assert');
var mapsforge = require('../src/mapsforge.js');

describe('mapsforge reader', function () {
  describe('header', function () {
    var mapInfo;
    before(function (done) {
      mapsforge.read('resources/file_header/output.map').then(function (info) {
        mapInfo = info;
        done();
      }, function (error) {
        console.log('ERROR!');
        throw error;
      });
    });
    it('should parse header values correctly', function () {
      assert.equal(mapInfo.fileVersion, 3);
      assert.equal(mapInfo.fileSize, 709);
      assert.deepEqual(mapInfo.boundingBox, {minLatitude: 0.1, minLongitude: 0.2, maxLatitude: 0.3, maxLongitude: 0.4});
      assert.equal(mapInfo.tilePixelSize, 256);
      assert.equal(mapInfo.projectionName, 'Mercator');
      // Optional
      assert.deepEqual(mapInfo.startPosition, [0.15, 0.25]);
      assert.equal(mapInfo.startZoomLevel, 16);
      assert.equal(mapInfo.languagePreference, 'en');
      assert.equal(mapInfo.comment, 'testcomment');
      assert.equal(mapInfo.createdBy, 'mapsforge-map-writer-0.3.1-SNAPSHOT');

      assert.equal(mapInfo.poiTags.length, 0);
      assert.equal(mapInfo.wayTags.length, 0);

      // private static final long MAP_DATE = 1335871456973L;
      // private static final int NUMBER_OF_SUBFILES = 3;

      //   Assert.assertEquals(MAP_DATE, mapFileInfo.mapDate);
      //   Assert.assertEquals(NUMBER_OF_SUBFILES, mapFileInfo.numberOfSubFiles);

      //   Assert.assertEquals(0, mapFileInfo.poiTags.length);
      //   Assert.assertEquals(0, mapFileInfo.wayTags.length);

      //   Assert.assertFalse(mapFileInfo.debugFile);
    });
  });

  describe('map data', function () {
    var mapInfo;
    before(function (done) {
      mapsforge.read('resources/with_data/output.map').then(function (info) {
        console.log('success');
        console.log(info);
        mapInfo = info;
        done();
      }, function (error) {
        console.log('ERROR!');
        console.log(error);
      });
    });
    var ZOOM_LEVEL_MIN = 6;
    it('read map data', function (done) {
      assert.equal(mapInfo.debugFile, true);
      mapInfo.readMapData(null, null, ZOOM_LEVEL_MIN).then(function (mapData) {
        // Assert.assertEquals(1, mapReadResult.pointOfInterests.size());
        // Assert.assertEquals(1, mapReadResult.ways.size());

        // checkPointOfInterest(mapReadResult.pointOfInterests.get(0));
        // checkWay(mapReadResult.ways.get(0));
        done();
      });
    });
  });
});
