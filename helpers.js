import pkg from 'axios';
import { ethers } from 'ethers';
const { axios } = pkg;

const toHHMMSS = unix => {
  var sec_num = parseInt(unix, 10);
  var hours = Math.floor(sec_num / 3600);
  var minutes = Math.floor((sec_num - hours * 3600) / 60);
  var seconds = sec_num - hours * 3600 - minutes * 60;
  if (hours < 10) {
    hours = '0' + hours;
  }
  if (minutes < 10) {
    minutes = '0' + minutes;
  }
  if (seconds < 10) {
    seconds = '0' + seconds;
  }
  return hours + ':' + minutes + ':' + seconds;
};

var fetched = {};
var lastTime = {};
var price = {};
async function getTokenPrice(token) {
  // console.log(`Getting token price: ${token}`);

  if (!fetched[token]) {
    fetched[token] = new Date().getTime();
  }

  if (fetched[token] < new Date().getTime() + 5000 && price[token]) {
    // console.log("cached");
    return price[token];
  }

  const resp = await pkg.get(
    `https://api.coingecko.com/api/v3/simple/price?ids=${token}&vs_currencies=usd`
  );
  // console.log(resp);
  let tokenPrice = resp.data[token].usd;

  price[token] = resp.data[token].usd;

  return tokenPrice;
}

async function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function shortenStr(str) {
  if (str.length < 10) return str;
  return `${str.slice(0, 6)}...${str.slice(str.length - 4)}`;
}

async function getTime() {
  let date_ob = new Date();

  // current date
  // adjust 0 before single digit date
  let date = ('0' + date_ob.getDate()).slice(-2);

  // current month
  let month = ('0' + (date_ob.getMonth() + 1)).slice(-2);

  // current year
  let year = date_ob.getFullYear();

  // current hours
  let hours = date_ob.getHours();

  // current minutes
  let minutes = date_ob.getMinutes();

  // current seconds
  let seconds = date_ob.getSeconds();

  // // prints date in YYYY-MM-DD format
  // console.log(year + "-" + month + "-" + date);

  // // prints date & time in YYYY-MM-DD HH:MM:SS format
  // console.log(year + "-" + month + "-" + date + " " + hours + ":" + minutes + ":" + seconds);

  // prints time in HH:MM format
  return hours + ':' + minutes;
}

function prettify(str, decimals) {
  if (!decimals) {
    decimals = 2;
  }
  return parseFloat(formatEth(str)).toFixed(decimals);
}

function formatEth(BigNumber) {
  return ethers.utils.formatEther(BigNumber.toString());
}

function getTokenStr(object, value) {
  for (var prop in object) {
    if (object.hasOwnProperty(prop)) {
      if (object[prop] === value) return prop;
    }
  }
}

export {
  toHHMMSS,
  getTokenPrice,
  sleep,
  shortenStr,
  getTime,
  prettify,
  getTokenStr,
  formatEth
};
