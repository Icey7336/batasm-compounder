_Installation:_

yarn
Edit .env.example -> .env (replacing variables with your own)

WEBSOCKET_URL = 'wss://' (websocket node use https://moralis.io/speedy-nodes/ to get one for free)
DISCORD_WEB_HOOK_URL = '' (a websocket to a discord channel for your convenience, not required leave blank if not using)
RPC_URL = 'https://rpc.ftm.tools' you can leave this as is
USD_CLAIM_THRESHOLD = 100 when you have pending rewards from the FTM-FTMB farm with a USD value above this number, it will claim them
CLAIM_THRESHOLD = "100" - used in conjunction with above, if you have pending rewards > this value it will claim them
USE_ZAPPER = false - automatically zap your FTM back into the BSM-FTMB farm
DEBUG = false - # if something goes wrong

# Make sure you don't share these values

WALLET_ADDRESS =
WALLET_PRIVATE_KEY =

_Running_

You should have deposited LP tokens into the BFTM-FTM farm before running this.

Run: node batasm.js

_What this does_

You should have deposited LP tokens into the BFTM-FTM farm before running this. Every 10 minutes it will check if the pending BSM rewards are greater than a USD value you specifiy or the amount of BSM. If the conditions are met, it will claim the BSM rewards and then withdraw them (50% penalty). Once withdrawn, it will then sell BSM to FTM on SpookySwap. Here you can choose to stop or zap the FTM gained back into the BFTM-FTM farm.
