console.log("test");

function getCM(moa, meters){
let moaPrMeter = 0.0290833;
let moaQty = moa * moaPrMeter;
let output = moaQty * meters;

let returnObj = {};
returnObj.moa = moa;
returnObj.meters = meters;
returnObj.cm = Math.round((output + Number.EPSILON) * 100) / 100;

return returnObj;

}

