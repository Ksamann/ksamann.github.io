console.log('Hello!');

let tripList = [];
let trip = [];
let stationCounter = 0;
let startTime = new Date();
let lastDeparture;

let path1 = [
  'Brattlikollen',
  'Karlsrud',
  'Lambertseter',
  'Munkelia',
  'Bergkrystallen',
];
tripList.push(path1);

let path2 = [
  'Bergkrystallen',
  'Munkelia',
  'Lambertseter',
  'Karlsrud',
  'Brattlikollen',
];
tripList.push(path2);

let path3 = [
  'Tøyen',
  'Ensjø',
  'Helsfyr',
  'Brynseng',
  'Hellerud',
  'Tveita',
  'Haugerud',
  'Trosterud',
  'Lindeberg',
  'Furuset',
];
tripList.push(path3);

let eastBtn = document.getElementById('EastBtn');
eastBtn.onclick = function () {
  start(0);
};

let westBtn = document.getElementById('WestBtn');
westBtn.onclick = function () {
  start(1);
};

let l2eastBtn = document.getElementById('L2EBtn');
l2eastBtn.onclick = function () {
  start(2);
};

class Stationstop {
  constructor(name) {
    this.name = name;
    this.platform;
    this.travelTime;
    this.arrivalTime;
    this.dwellTime;
    this.departureTime;
  }

  getArrivalTime() {
    return this.arrivalTime.toLocaleTimeString();
  }

  arrive() {
    this.arrivalTime = new Date().toLocaleTimeString();
    console.log(trip);
    updateTable();
  }
}

function arrive(station) {
  station.arrivalTime = new Date();
  if (lastDeparture != undefined) {
    station.travelTime = new Date(
      station.arrivalTime - lastDeparture - 3600000
    );
  }
  console.log(trip);
  updateTable();
}

function start(triplist) {
  makeTrip(tripList[triplist]);
  updateTable();
}

function depart(station) {
  let stamp = new Date();
  station.departureTime = stamp;
  lastDeparture = stamp;
  if (station.arrivalTime != undefined) {
    station.dwellTime = new Date(station.departureTime - station.arrivalTime);
  }
  console.log(trip);
  console.log('count ' + stationCounter);
  stationCounter++;
  updateTable();
  if (stationCounter == trip.length) {
    console.log('finish');
    finish();
  }
}

function finish() {
  let card = document.createElement('div');
  card.setAttribute('class', 'card');
  let cardbody = document.createElement('div');
  cardbody.setAttribute('class', 'card-body');
  cardbody.innerHTML = '<h5>Finished!</h5>';
  card.appendChild(cardbody);

  let reportBtn = document.createElement('a');
  let results = JSON.stringify(trip);
  reportBtn.setAttribute('href', 'mailto:?subject=Time Study&body=' + results);
  reportBtn.setAttribute('class', 'btn btn-primary');
  reportBtn.innerHTML = 'Report by e-mail';
  reportBtn.onclick = function () {
    console.log('sent');
    cardbody.innerHTML += "<h6 class='text-success'>Thanks!</h6>";
    //sendReport();
  };
  cardbody.appendChild(reportBtn);

  let main = document.getElementById('Main');
  main.appendChild(card);
}

function sendReport() {}

function makeTrip(path) {
  trip = [];
  stationCounter = 0;
  for (let i = 0; i < path.length; i++) {
    let station = new Stationstop(path[i]);
    trip.push(station);
  }
  console.log(trip);
}

function updateTable() {
  let table = document.getElementById('TripTable');
  table.innerHTML = '';
  let header = document.createElement('thead');
  table.appendChild(header);
  let row = document.createElement('tr');
  header.appendChild(row);
  row.innerHTML =
    '<th>Station</th><th>Travel</th><th>Arrived</th><th>Dwell</th><th>Departed</th>';

  let body = document.createElement('tbody');
  table.appendChild(body);
  //Expand active row
  for (let i = 0; i < trip.length; i++) {
    let row = document.createElement('tr');
    if (i == stationCounter) {
      //row.setAttribute('class', 'act');
    }

    //Add name cell
    let nameCell = document.createElement('td');
    nameCell.innerHTML = trip[i].name;
    row.appendChild(nameCell);

    //Add travel time cell
    let ttCell = document.createElement('td');
    if (i == 0) {
      ttCell.innerHTML = '--';
    } else if (trip[i].travelTime != undefined) {
      ttCell.innerHTML = trip[i].travelTime.toLocaleTimeString().substring(3);
    } else if (
      trip[i].travelTime == undefined &&
      trip[i - 1].departureTime != undefined
    ) {
      let spin = document.createElement('div');
      spin.setAttribute('class', 'spinner-border text-primary');
      ttCell.appendChild(spin);
    }
    row.appendChild(ttCell);

    //Add arrival time cell
    let arrivalCell = document.createElement('td');
    if (i == stationCounter && trip[i].arrivalTime == undefined) {
      let arriveBtn = document.createElement('button');
      arriveBtn.innerHTML = 'Arrive';
      arriveBtn.setAttribute('type', 'button');
      arriveBtn.setAttribute('class', 'btn btn-warning');
      arriveBtn.onclick = function () {
        arrive(trip[i]);
      };
      arrivalCell.appendChild(arriveBtn);
    } else if (trip[i].arrivalTime == undefined) {
      arrivalCell.innerHTML = '';
    } else {
      arrivalCell.innerHTML = trip[i].arrivalTime.toLocaleTimeString();
    }
    row.appendChild(arrivalCell);

    //Add dwell cell
    let dwellCell = document.createElement('td');
    if (trip[i].dwellTime != undefined) {
      dwellCell.innerHTML = trip[i].dwellTime.toLocaleTimeString().substring(3);
    } else if (
      trip[i].dwellTime == undefined &&
      trip[i].arrivalTime != undefined
    ) {
      let spin = document.createElement('div');
      spin.setAttribute('class', 'spinner-grow text-danger');
      dwellCell.appendChild(spin);
    }
    row.appendChild(dwellCell);

    //Add departure cell
    let depCell = document.createElement('td');
    if (i == stationCounter && trip[i].departureTime == undefined) {
      let departBtn = document.createElement('button');
      departBtn.innerHTML = 'Depart';
      departBtn.setAttribute('class', 'btn btn-success');
      if (
        i != 0 &&
        trip[i - 1].departureTime != undefined &&
        trip[i].arrivalTime == undefined
      ) {
        console.log('disabled');
        departBtn.setAttribute('class', 'btn btn-success disabled');
      }
      departBtn.onclick = function () {
        depart(trip[i]);
      };
      depCell.appendChild(departBtn);
    } else if (trip[i].departureTime == undefined) {
      depCell.innerHTML = '';
    } else {
      depCell.innerHTML = trip[i].departureTime.toLocaleTimeString();
    }
    row.appendChild(depCell);

    body.appendChild(row);
  }
}

makeTrip(path1);
updateTable();
