// this code is available in GEE cloud platform 
// https://code.earthengine.google.com/baa95cfdd09e0630e21f6aa4ffe87eaa

var image = ee.Image("projects/ee-swiftt/assets/SWIFTT_ForestType2022");

var Pellete_class = [
  '2ac200', // 1 - Broadleaved woodland
  'fff900', // 2 - Coniferous woodland
  'ffdddb', // 3 - Mixed woodland
];

Map.setCenter(16.58, 49.88, 5)

Map.addLayer(image,
             {palette: Pellete_class, min: 1, max: 3},
             'SWIFTT Forest Type 2022');
             