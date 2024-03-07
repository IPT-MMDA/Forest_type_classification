// this code is available in GEE cloud platform 
// https://code.earthengine.google.com/8a7c6b1cb32120385c77d70b2a290217

//countries contours
var eu_contours = ee.FeatureCollection("projects/ee-swiftt/assets/countries_groups")
//select the countries group number from 1 to 11
var contour = eu_contours.filter(ee.Filter.eq('Group', 1)) 
Map.addLayer(contour, {}, 'eu_contours', false)

// We find the centroid of our polygon and insert it into Map.setCenter to zoom our territory
var polygonCentroid = contour.geometry().centroid();
Map.setCenter(ee.Number(polygonCentroid.coordinates().get(0)).getInfo(), ee.Number(polygonCentroid.coordinates().get(1)).getInfo(), 6);

//training data
var train_set = ee.FeatureCollection("projects/ee-swiftt/assets/SWIFTT_TRTT");
//select train set
train_set = train_set.filter(ee.Filter.eq('SET', 1)).filterBounds(contour) 
Map.addLayer(train_set, {}, 'train_set', false)

//Buffering the train samples
train_set = train_set.map(function(f) {return f.buffer(3)})


//------------------------------- Sentinel-2 data

//cloud masking Sentinel-2
function maskS2clouds3(image) {
  var qa = image.select('SCL');
  // Bits 10 and 11 are clouds and cirrus, respectively.
  var mask = qa.eq(1).or(qa.eq(2)).or(qa.eq(4)).or(qa.eq(5)).or(qa.eq(6)).or(qa.eq(7))
  return image.updateMask(mask).divide(10000);
}

//selecting of Sentinel-2 bands
var s2b = ['B2', 'B3', 'B4', 'B8'];

var dataset = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
                  .filterDate('2022-03-01', '2022-06-01')
                  // Pre-filter to get less cloudy granules.
                  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 40))
                  .map(maskS2clouds3)
				          .select(s2b)                  

//compositing of Sentinel-2
var dataset1 = (dataset.median()).clip(contour).select(s2b);

var dataset = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
                  .filterDate('2022-06-01', '2022-08-01')
                  // Pre-filter to get less cloudy granules.
                  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 40))
                  .map(maskS2clouds3)
                  .select(s2b)

var dataset2 = (dataset.median()).clip(contour).select(s2b);

var dataset = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
                  .filterDate('2022-08-01', '2022-09-30')
                  // Pre-filter to get less cloudy granules.
                  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 50))
                  .map(maskS2clouds3)
                  .select(s2b)

                
var dataset3 = (dataset.median()).clip(contour).select(s2b);


var rgbViss = {
  min: 0,
  max: 0.3,
  bands: ['B4', 'B3', 'B2'],
};


Map.addLayer(dataset1, rgbViss, 'S2-2022-03-01-2022-06-01', false);
Map.addLayer(dataset2, rgbViss, 'S2-2022-06-01-2022-08-01', false);
Map.addLayer(dataset3, rgbViss, 'S2-2022-08-01-2022-09-30', false);

//Sentinel-2 stack creation
var dataset_s2 = dataset1.addBands(dataset2).addBands(dataset3);
//-------------------------------end of Sentinel-2


// ------------------- Sentinel-1 data

//preprocessing
function toNatural(img) {
  return ee.Image(10.0).pow(img.select('..').divide(10.0)).copyProperties(img, ['system:time_start']);
}

function toDB(img) {
  return ee.Image(img).log10().multiply(10.0);
}

function maskEdge(img) {
  var mask = img.select(0).unitScale(-25, 5).multiply(255).toByte().connectedComponents(ee.Kernel.rectangle(1,1), 100);
  return img//.updateMask(mask.select(0));
}

var start_date = '2022-03-01'
var end_date = '2022-10-30'
var step = 12

var s1bands = ['VV', 'VH'];
var s1 = ee.ImageCollection('COPERNICUS/S1_GRD').filterBounds(contour).filterDate(start_date, end_date);
s1 = s1.filter(ee.Filter.eq('transmitterReceiverPolarisation', ["VV","VH"]));
s1 = s1.map(maskEdge)
s1 = s1.map(toNatural)

var days = ee.List.sequence(0, ee.Date(end_date).difference(ee.Date(start_date), 'day'), step).
  map(function(d) { return ee.Date(start_date).advance(d, "day") })

var dates = days.slice(0,-1).zip(days.slice(1))
var s1res = dates.map(function(range) {
  var dstamp = ee.Date(ee.List(range).get(0)).format('YYYYMMdd')
  var temp_collection = s1.filterDate(ee.List(range).get(0),
    ee.List(range).get(1)).mean().select(['VV', 'VH'], [ee.String('VV_').cat(dstamp), ee.String('VH_').cat(dstamp)])
  return temp_collection
})


function stack(i1, i2)
{
  return ee.Image(i1).addBands(ee.Image(i2))
}

//Sentinel-1 stack creation
var s1stack = ee.Image(s1res.slice(1).iterate(stack, s1res.get(0)))

//Data filtering
s1stack = s1stack.reduceNeighborhood(ee.Reducer.mean(), ee.Kernel.rectangle(3,3)).clip(contour)
Map.addLayer(s1stack, {}, 'Sentinel-1 stack', false)

// -------------------------------- end of Sentinel-1


// Satellite data common stack (Sentinel-2 and Sentinel-1)
var satellite_stack = s1stack.addBands(dataset_s2);

// ------------ Classification

var training_scale = 10;
var training_property = 'CLASS';

var training = satellite_stack.sampleRegions({
  collection:train_set, 
  scale: training_scale,
  tileScale: 4});

var trained = ee.Classifier.smileRandomForest(100).train(training, training_property);
var classified = satellite_stack.classify(trained).clip(contour);


// Export a cloud-optimized GeoTIFF.
//!!! the classifier operation time and loading 
//of the resulting map to disk may vary depending 
//on the area of the territory and system load

Export.image.toDrive({
  image: classified.toByte(),
  description: 'Classification_for_Group_1',
 'fileNamePrefix': 'Classification_Group_1',
 'folder': 'Forest_type_Map', // change folder name
  scale: 10,
  region: contour,
  fileFormat: 'GeoTIFF',
  'maxPixels' : 10000000000000,
  formatOptions: {
    cloudOptimized: true
  }
});
