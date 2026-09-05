import assert from 'node:assert/strict';
import { normalizeStoreOperations, deliveryEta, canTransitionFoodOrder } from '../food-operations.js';

const operations = normalizeStoreOperations({businessType:'food',preparationMinMinutes:15,preparationMaxMinutes:25,
  acceptingOrders:true,fulfillmentMode:'both',weeklyHours:{monday:{opens:'09:00',closes:'18:00'}}});
assert.equal(operations.businessType,'food');
assert.deepEqual(operations.weeklyHours[0],{day:'monday',closed:false,opens:'09:00',closes:'18:00'});
assert.throws(()=>normalizeStoreOperations({weeklyHours:{monday:{opens:'18:00',closes:'09:00'}}}),/invalid_hours/);
assert.deepEqual(deliveryEta({preparationMinMinutes:15,preparationMaxMinutes:25,routeDurationSeconds:601}),{routeMinutes:11,etaMinMinutes:26,etaMaxMinutes:37});
assert.equal(canTransitionFoodOrder('food_awaiting_acceptance','food_accepted'),true);
assert.equal(canTransitionFoodOrder('food_awaiting_acceptance','food_ready'),false);
console.log('food operations tests passed');
