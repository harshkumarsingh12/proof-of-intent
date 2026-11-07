-- A PayPal wallet can belong to more than one shopper row. PayPal hands back the same Vault v3 payment token for the
-- same PayPal account, and a shopper who clicks "Use a new key" (or opens the shop in another browser) becomes a new
-- shopper row that saves the same wallet again. The unique constraint made that save fail with a 500
-- ("duplicate key value violates unique constraint shoppers_vault_id_key"), and the old row can't be cleared because
-- its key is gone. Authority still comes from PayPal: saving needs an approval by the PayPal account itself.
-- The payment token is revoked at PayPal only when the last shopper holding it removes it (see removeWallet).
alter table shoppers drop constraint shoppers_vault_id_key;
create index shoppers_vault_id_idx on shoppers (vault_id) where vault_id is not null;
