import {autoApplySpatialCityIdentity,spatialIdentityCityFromLocation} from './vitriny-spatial-city-identity.js';

const cityId=spatialIdentityCityFromLocation();
autoApplySpatialCityIdentity({cityId}).then(identity=>{
  try{dispatchEvent(new CustomEvent('vitriny:spatial-city-identity',{detail:{cityId,themeId:identity.themeId,landmark:identity.landmark.id}}));}catch{}
}).catch(()=>{});
