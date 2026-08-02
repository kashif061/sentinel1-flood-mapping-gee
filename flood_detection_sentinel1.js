var geometry = 
    ee.FeatureCollection("projects/learning-gee-494316/assets/dbg_boundary");
var imageCollection = ee.ImageCollection("COPERNICUS/S1_GRD");
// * FLOOD MAPPING USING SENTINEL-1 IMAGERY IN GEE *
// 1. DEFINING AREA OF INTEREST AND DATES

// Pre-flood (baseline) period
var preStart = '2025-05-01';
var preEnd = '2025-05-30';

//Post-flood (event) period
var postStart = '2025-08-01';
var postEnd = '2025-08-30';

//Parameters
var polarization = 'VV';
var passDirection = 'ASCENDING';
var threshold = 1.25;
var slopeThreshold = 5;

var s1 = imageCollection.filterBounds(geometry)
//.filter(ee.Filter.eq('instrumentMode', 'IW'))
//.filter(ee.Filter.eq('transmitterReceiverPolarisation', polarization))
//.filter(ee.Filter.eq('orbitProperties_pass','passDirection'))
.select(polarization);

//Creating the mosaics
var preImage = s1.filterDate(preStart,preEnd).mosaic().clip(geometry);
var postImage = s1.filterDate(postStart, postEnd).mosaic().clip(geometry);

print (preImage);
print (postImage);

print ('preImage count:', s1.filterDate(preStart, preEnd).size());
print ('postImage count:', s1.filterDate(postStart, postEnd).size());

//Speckle filtering (focal mean)
var smoothingRadius = 50; //meters
var preFiltered = preImage.focal_mean(smoothingRadius, 'circle', 'meters');
var postFiltered = postImage.focal_mean(smoothingRadius, 'circle', 'meters');

//Flood detection (Ratio & Thresholding)
//Smooth water surfaces scatter radar away, showing up as low/dark values in post-flood
var ratio = preFiltered.divide(postFiltered);
var rawFlood = ratio.gt(threshold);

//Masking noise, slopes, and permamnet water

//A. Slope masking (HydroSHEDS DEM)
var dem = ee.Image('WWF/HydroSHEDS/03CONDEM');
var slope = ee.Terrain.slope(dem);
var slopeMask = slope.lt(slopeThreshold);

//B. Permanent Water Mask (JRC Global Surface Water)
var jrcWater = ee.Image('JRC/GSW1_4/GlobalSurfaceWater');
var permanentWater = jrcWater.select('occurrence').gt(80); //Areas wet > 80% of time
var nonPermanentWaterMask = permanentWater.eq(0);

//Comining masks
var finalFlood = rawFlood
.updateMask(slopeMask)
.updateMask(nonPermanentWaterMask)
.selfMask(); //Hide non-flooded background pixels

// Calculating flooded area
var floodAreaImage = finalFlood.multiply(ee.Image.pixelArea());
var areaStats = floodAreaImage.reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: geometry,
  scale: 10,
  maxPixels: 1e9
});

var floodAreaHa = 
ee.Number(areaStats.get(polarization)).divide(10000); //convert sq m to ha
print ('Est Flooded Area (ha):', floodAreaHa);

//Visualization on map
Map.centerObject(geometry, 12);

//Adding pre and post images in dB scale representation
Map.addLayer(preFiltered, {min: -25, max: 0}, 'Pre-Flood SAR (Smoothed)', false);
Map.addLayer(postFiltered, {min: -25, max:0}, 'Post-Flood SAR (Smoothed)', false);

//RGB Composite (Red: Pre, Green: Post, Blue: Post)
//Flooded land appears distinctly bright red/orange due to drop in SAR signal

Map.addLayer(
  ee.Image.cat([preFiltered, postFiltered, postFiltered]),
  {min: -25, max: 0},
  'Pre/Post RGB Composite'
  );
  
  //JRC Permanent water
  Map.addLayer(permanentWater.selfMask(), {palette: ['0000FF']},
  'Permanent Water Bodies', false);
  
  //Final Flood Extent
  Map.addLayer(finalFlood, {palette: ['FF0000']},
  'Detected Flood Extent');
  
  //Exporting the mask to G-Drive
  Export.image.toDrive({
    image:finalFlood,
    description: 'Sentinel1_Flood_Mask',
    scale: 10,
    region: geometry,
    maxPixels: 1e9
  });
