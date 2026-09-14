import Database from 'better-sqlite3';
import path from 'node:path';
const db=new Database(path.join(process.env.DATA_DIR||'/data','vitrinecity.db'),{readonly:true,fileMustExist:true});
db.pragma('query_only = ON');
const exists=t=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
const one=(t,sql)=>exists(t)?db.prepare(sql).get():null;
const report=db.transaction(()=>({
  wallets:one('wallets','SELECT COUNT(*) accounts,COALESCE(SUM(balance_units),0) totalUnits,COALESCE(SUM(balance_units<0),0) negativeAccounts FROM wallets'),
  legacyCoverage:exists('wallets')&&exists('credit_batches')?db.prepare("SELECT COUNT(*) mismatchedAccounts,COALESCE(SUM(w.balance_units-COALESCE(b.n,0)),0) differenceUnits FROM wallets w LEFT JOIN (SELECT user_id,SUM(remaining_units) n FROM credit_batches WHERE status='active' GROUP BY user_id)b ON b.user_id=w.user_id WHERE w.balance_units<>COALESCE(b.n,0)").get():null,
  rewardSettings:one('city_reward_settings','SELECT coins_per_real coinsPerReal,daily_limit dailyLimit FROM city_reward_settings WHERE id=1'),
  rewardBatches:one('city_reward_batches','SELECT COUNT(*) lots,COALESCE(SUM(remaining),0) remainingPoints FROM city_reward_batches'),
  pendingRewardOrders:one('city_reward_orders',"SELECT COUNT(*) count FROM city_reward_orders WHERE status IN ('created','creating','pending','review_required','payment_unknown')"),
  pendingCreditOrders:one('credit_orders',"SELECT COUNT(*) count FROM credit_orders WHERE status IN ('created','pending','authorized','in_process','in_mediation','review_required')"),
  aiLots:one('neural_ai_credit_lots','SELECT COUNT(*) count,COALESCE(SUM(reserved_micro),0) reservedMicro FROM neural_ai_credit_lots'),
  paidJobs:one('neural_paid_chat_requests',"SELECT COUNT(*) count FROM neural_paid_chat_requests WHERE phase<>'finished'"),
  unifiedWalletExists:exists('vitrine_coin_lots')
}))();
db.close();console.log(JSON.stringify({readOnly:true,...report}));
