import { ethers, BigNumber } from 'ethers';
import { getTokenPrice, sleep, getTime, prettify } from './helpers.js';
import { createRequire } from 'module';

import chalk from 'chalk';

const require = createRequire(import.meta.url);
require('dotenv').config();
require('log-timestamp')('Batasm Compounder');
const { Webhook } = require('discord-webhook-node');

const log = console.log;
const verbose = process.env.DEBUG;

const info = str => {
  log(chalk.green(str));
  notify('Batasm', 'Update', `**${str}**`);
};

const pending = str => {
  log(chalk.bgCyan(str));
  notify('Sending Tx', 'Pending', str, 'info');
};

const txyay = str => {
  log(chalk.bgMagenta(str));
  notify('Tx Success', 'Complete', str, 'success');
};

const txsad = str => {
  log(chalk.red(str));
  notify('Tx error', 'Reverted', str, 'error');
};

const debug = str => {
  if (verbose) {
    log(chalk.yellow(str));
    notify('Batasm', 'Debug', str);
  }
};

const userinfo = str => {
  log(chalk.blue(str));
  notify('Batasm', 'User Info', str);
};

const spookyAbi = require('./abi/spookyabi.json');
const zapAbi = require('./abi/FantasticZap.json');
const poolAbi = require('./abi/poolAbi.json');
const miniChefAbi = require('./abi/minichefAbi.json');
const stakingAbi = require('./abi/stakingAbi.json');
const oracleAbi = require('./abi/oracleAbi.json');
const IERC20 = require('./abi/IERC20.json');

const useZap = process.env.USE_ZAPPER;
const wss = process.env.WEBSOCKET_URL;
const rpc = process.env.RPC_URL;
const discord_web_hook = process.env.DISCORD_WEBHOOK;

let hook;
hook = new Webhook({
  url: discord_web_hook,
  throwErrors: false,
  retryOnLimit: true
});

if (discord_web_hook != null) {
  debug(`No discord webhook provided. Console notifications only.`);
}

//settings
const USD_CLAIM_THRESHOLD = process.env.USD_CLAIM_THRESHOLD; // if usd value of BSM we claim
const CLAIM_THRESHOLD = ethers.utils.parseEther(process.env.CLAIM_THRESHOLD); //if we have >BSM we claim
const ADDITIONAL_GAS = ethers.utils.parseUnits('250', 'gwei'); //price ours slightly above the median? in GWEI

//contracts
const contracts = {
  bftm: '0xdc79AFCe5AE2300834B2bB575bC40cF78EF7b5e3',
  bftm_ftm_lp: '0xbc4B67Ccef529929a7FA984A46133d4Ddb452Ae0',
  bsm: '0xB214d491a58a250A99f11cE01C361E7fAd4d3E69',
  bsm_ftm_lp: '0xaEf0C4d2c0d96434BD9047271E5CfE6fa335add2',
  pool: '0xE6741CEcf9879fd6FEFbe5160a4b7c5DAe0eb691',
  minichef: '0x51e3ed8FB95728e3189D54e818c94D1817B80D05',
  staking: '0x2BCeAB76feB10F167C8B50c1E4b2676fce27F434',
  spookyRouter: '0xF491e7B69E4244ad4002BC14e878a34207E38c29',
  wftm: '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83',
  zap: '0xC466912c91696aBb2a90083b1658b7b816595875', //this is a zapper that I deployed, it's unverified and I can't figure out why it won't verify. DYOR: it's disabled by default.
  oracle: '0x0AEA3BAFD72fc6c5245fAC5908997d966a8a746F'
};

let notify = async (title, subtitle, msg, type) => {
  if (discord_web_hook === null) return;
  switch (type) {
    case 'info':
      await hook.info(title, subtitle, `**${msg}**`);
      break;
    case 'success':
      await hook.success(title, subtitle, msg);
      break;
    case 'warning':
      await hook.warning(title, subtitle, msg);
      break;
    case 'error':
      await hook.error(title, subtitle, msg);
      break;
    default:
      await hook.send(msg);
      break;
  }
};

let signer = getSigner();
let provider = getProvider();

signer._websocket.on('error', async () => {
  debug(`Unable to connect to ${ep.subdomain} retrying in 3s...`);
  setTimeout(() => getSigner(), 3000);
});
signer._websocket.on('close', async code => {
  debug(`Connection lost with code ${code}! Attempting reconnect in 3s...`);
  signer._websocket.terminate();
  setTimeout(() => getSigner(), 3000);
});

function getSigner() {
  debug('Connecting...');
  let signer = new ethers.providers.WebSocketProvider(wss);
  return signer;
}

function getProvider() {
  let provider = new ethers.providers.JsonRpcProvider(rpc);
  return provider;
}

function getContract(account, abi, whichct) {
  let ct = new ethers.Contract(whichct, abi, account);
  return ct;
}

function getAccount(wallet) {
  const account = wallet.connect(signer);
  return account;
}

function getWallet(PRIVATE_KEY) {
  const wallet = new ethers.Wallet(PRIVATE_KEY);
  return wallet;
}

async function getTxOptions(extra) {
  let gasPrice = await provider.getGasPrice();
  extra ? (gasPrice = gasPrice.add(ADDITIONAL_GAS)) : gasPrice;
  var options = {
    gasPrice: gasPrice
  };
  return options;
}

let init = async (account, wallet) => {
  //const blockNumber = await provider.getBlockNumber()
  const balanceFtm = await signer.getBalance(wallet.address);
  const cleanFtmbalance = parseFloat(
    ethers.utils.formatEther(balanceFtm.toString())
  ).toFixed(2);

  let time = await getTime();

  const ftmPrice = await getTokenPrice('fantom');
  const ftmValue = (cleanFtmbalance * ftmPrice).toFixed(2);

  let gasPrice = await signer.getGasPrice();
  const gasPriceGwei = ethers.utils.formatUnits(gasPrice, 'gwei');

  try {
    hook.setUsername('Batasm-compounder');
  } catch (e) {
    debug(`Error setting discord username ${e}`);
  }

  userinfo(`${wallet.address} | Gas - ${gasPriceGwei} gwei | ${time}`);
  info(`FTM balance: ${cleanFtmbalance} ($${ftmValue})`);

  return true;
};

let sellTokenByAmount = async (account, wallet, amount, tokenStr, retry) => {
  if (retry < 1) return false;
  let spookyRouterContract = await getContract(
    account,
    spookyAbi.abi,
    contracts.spookyRouter
  );
  let tokenCt = await getContract(account, IERC20.abi, tokenStr);
  let tokenBalance = await tokenCt.balanceOf(wallet.address);
  let ftmBalance = await signer.getBalance(wallet.address);

  let swapTx;

  if (!BigNumber.isBigNumber(amount)) {
    amount = tokenBalance;
  }

  let amountIn = amount ? amount : tokenBalance;
  let amountOutMin = 0;
  let path = [tokenStr, contracts.wftm];
  let to = wallet.address;
  let deadline = Math.floor(new Date().getTime() / 1000) + 60 * 5; //5 minutes

  let checkApproval = await checkApprovalForSell(
    account,
    wallet,
    tokenStr,
    amountIn
  );

  let cleanBalance = prettify(amountIn, 5);
  let tokenPrice = await getBSMPrice(account, wallet);

  let tokenValue = (cleanBalance * tokenPrice).toFixed(2);

  let options = await getTxOptions();

  if (tokenBalance.gte(amountIn) && checkApproval) {
    info(`Selling ${cleanBalance} ${tokenStr} ($${tokenValue})`);
    try {
      swapTx = await spookyRouterContract.swapExactTokensForETH(
        amountIn,
        amountOutMin,
        path,
        to,
        deadline,
        options
      );
      await swapTx.wait();
    } catch (e) {
      txsad(`Error in sell ${e}`);
      await sellTokenByAmount(account, wallet, amount, tokenStr, retry - 1);
      return;
    } finally {
      if (swapTx) {
        txyay(
          `Sold ${prettify(
            amountIn
          )} BSM ${tokenValue} USD: https://ftmscan.com/tx/${swapTx.hash}/`
        );
        let newBalanace = await signer.getBalance(wallet.address);
        let balanceDelta = newBalanace.sub(ftmBalance);
        return balanceDelta;
      }
    }
  } else {
    debug(`${tokenStr} balance was too low!`);
    debug(
      `We have ${tokenBalance}, amount ${amount}, amountIn ${amountIn}, checkApproval ${checkApproval}`
    );
    return false;
  }
  return false;
};

let checkApprovalForSell = async (account, wallet, tokenStr, amount) => {
  let tokenCt = await getContract(account, IERC20.abi, tokenStr);
  let spookyRouterCt = await getContract(
    account,
    spookyAbi.abi,
    contracts.spookyRouter
  );
  let tokenBalance = await tokenCt.balanceOf(wallet.address);
  //for selling
  const allowance = await tokenCt.allowance(
    wallet.address,
    spookyRouterCt.address
  );
  amount = amount ? amount : tokenBalance;

  if (allowance.lte(amount)) {
    pending(`Approving ${tokenStr}`);
    debug(
      `allowance ${prettify(allowance)}, balance ${prettify(
        tokenBalance
      )}, amount ${prettify(amount)}`
    );
    let approveTx;
    //send approval
    try {
      approveTx = await tokenCt.approve(
        spookyRouterCt.address,
        ethers.utils.parseEther('10000000')
      );
      await approveTx.wait();
    } catch (e) {
      txsad(`ERROR: ${e}`);
      return;
    } finally {
      if (approveTx) {
        txyay(
          `Approved ${tokenStr}: https://ftmscan.com/tx/${approveTx.hash}/`
        );
        return true;
      }
    }
  } else {
    return true;
    //token is already approved for selling
  }
};

let areRewardsPending = async (account, wallet, pid) => {
  let miniChefCt = await getContract(
    account,
    miniChefAbi.abi,
    contracts.minichef
  );

  let pendingRewards = await miniChefCt.pendingReward(pid, wallet.address);

  let bsm_price = await getBSMPrice(account, wallet);
  let pendingRewardsClean = prettify(pendingRewards);
  let reward_value = bsm_price * pendingRewardsClean;

  debug(
    `Pending rewards: ${prettify(pendingRewards)} BSM | ${reward_value} USD`
  );

  if (
    pendingRewards.gt(CLAIM_THRESHOLD) ||
    reward_value > USD_CLAIM_THRESHOLD
  ) {
    debug(
      `Pending rewards are greater than ${prettify(
        CLAIM_THRESHOLD
      )} BSM or ${USD_CLAIM_THRESHOLD} USD`
    );
    return true;
  }
  return false;
};

let getBSMPrice = async (account, wallet) => {
  let oracleCt = await getContract(account, oracleAbi.abi, contracts.oracle);
  let bsm = await oracleCt.getYTokenPrice();
  let bsm_pretty = prettify(bsm);
  let ftm_price = await getTokenPrice('fantom');

  let bsm_usd_price = bsm_pretty * ftm_price;
  return bsm_usd_price;
};

let claimRewards = async (account, wallet, pid, retry) => {
  if (retry < 1) return false;
  let miniChefCt = await getContract(
    account,
    miniChefAbi.abi,
    contracts.minichef
  );

  let harvestTx;
  debug(`Claiming rewards`);
  try {
    harvestTx = await miniChefCt.harvest(pid, wallet.address);
    await harvestTx.wait();
  } catch (e) {
    txsad(`Error in harvest ${e}`);
    await claimRewards(account, wallet, pid, retry - 1);
    return false;
  } finally {
    if (harvestTx) {
      txyay(`Harvested rewards https://ftmscan.com/tx/${harvestTx.hash}`);
      return true;
    }
  }
  return false;
};

let withdrawRewards = async (account, wallet, pid, retry) => {
  if (retry < 1) return false;
  let stakingCt = await getContract(account, stakingAbi.abi, contracts.staking);

  let withdrawableBal = await stakingCt.withdrawableBalance(wallet.address);

  debug(
    `Withdrawable balance: ${prettify(withdrawableBal[1])} BSM | ${
      prettify(withdrawableBal[1]) * (await getBSMPrice(account, wallet))
    } USD`
  );
  let withdrawTx;

  try {
    withdrawTx = await stakingCt.withdraw(withdrawableBal[1]);
    await withdrawTx.wait();
  } catch (e) {
    txsad(`Error in withdraw, retrying`);
    await withdrawRewards(account, wallet, pid, retry - 1);
    return false;
  } finally {
    if (withdrawTx) {
      txyay(
        `Withdrew rewards with penalty https://ftmscan.com/tx/${withdrawTx.hash}`
      );
      return true;
    }
  }
  return false;
};

let zapIn = async (account, wallet, ftmIn, pid, retry) => {
  if (retry < 1) return false;
  let zapCt = await getContract(account, zapAbi.abi, contracts.zap);
  let options = { value: ftmIn };
  let zapTx;
  debug(`Zapping in with ${prettify(ftmIn)} FTM`);
  try {
    zapTx = await zapCt.zap('0', '1', 'true', options);
    await zapTx.wait();
  } catch (e) {
    txsad(`Error in zap ${e}`);
    await zapIn(account, wallet, ftmIn, pid, retry - 1);
    return false;
  } finally {
    if (zapTx.hash) {
      txyay(`Zapped in with FTM: https://ftmscan.com/tx/${zapTx.hash}`);
      return true;
    }
  }
};

//let targetAccount = targetAccounts[i];
let wallet = getWallet(process.env.WALLET_PRIVATE_KEY);
let account = getAccount(wallet);
let time = await getTime();
await loop(account, wallet);
setInterval(async function () {
  userinfo(`${time} | --Repeating loop--`);
  await loop(account, wallet);
  sleep(5000);
}, 600000);

async function loop(account, wallet) {
  await init(account, wallet);
  //do we have FTM hanging around we can Zap in with?
  let shouldClaim = await areRewardsPending(account, wallet, '1');
  let claimed;
  let withdrawn;
  let soldAmount;
  if (shouldClaim) {
    claimed = await claimRewards(account, wallet, '1', 3);
  }
  if (claimed) {
    withdrawn = await withdrawRewards(account, wallet, '1', 3);
  }
  if (withdrawn) {
    soldAmount = await sellTokenByAmount(
      account,
      wallet,
      'max',
      contracts.bsm,
      3
    );
  }
  if (soldAmount && useZap) {
    let zap = await zapIn(account, wallet, soldAmount, '1', 3);
  }
}
