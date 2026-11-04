import { useId, useRef, useState, type ChangeEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AccountSummary } from "../../types/app";
import { useI18n } from "../../i18n/I18nProvider";
import { formatFullDate } from "../../utils/dateFormatting";
import { OPENAI_BILLING_URL } from "../../utils/openaiApi";
import { UtilityDialog } from "../workspace/UtilityDialog";
import { SecretInput } from "./import/SecretInput";

export function OpenAiBalancePanel({ account, busy, onUpdated }: {
  account: AccountSummary;
  busy: boolean;
  onUpdated?: () => Promise<unknown>;
}) {
  const { copy, locale } = useI18n();
  const text = copy.addAccount;
  const [importing, setImporting] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  return (
    <section className="detailCard openAiBalanceCard">
      <div className="detailCardTitle">
        <h3>{text.apiBalanceTitle}</h3>
        <strong className="openAiBalanceAmount">{account.balanceText ?? text.apiBalanceUnavailable}</strong>
      </div>
      <p className="pageSectionDescription">{text.apiBalanceHint}</p>
      {account.apiBalanceFetchedAt ? (
        <p className="pageSectionDescription">
          {text.apiBalanceLastChecked} · {formatFullDate(account.apiBalanceFetchedAt, locale, "—")}
        </p>
      ) : null}
      <div className="openAiBalanceActions">
        <button type="button" className="ghost" disabled={busy} onClick={() => setImporting(true)}>
          {text.apiBalanceImportSession}
        </button>
        <button type="button" className="ghost" onClick={() => {
          setLinkError(null);
          void invoke("open_external_url", { url: OPENAI_BILLING_URL }).catch((error: unknown) => setLinkError(String(error)));
        }}>{text.apiBalanceBillingLink}</button>
      </div>
      {linkError ? <p role="alert">{linkError}</p> : null}
      {importing ? (
        <BalanceSessionDialog account={account} onUpdated={onUpdated} onClose={() => setImporting(false)} />
      ) : null}
    </section>
  );
}

function BalanceSessionDialog({ account, onUpdated, onClose }: {
  account: AccountSummary;
  onUpdated?: () => Promise<unknown>;
  onClose: () => void;
}) {
  const { copy } = useI18n();
  const text = copy.addAccount;
  const id = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [fileName, setFileName] = useState("");
  const [querying, setQuerying] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = querying || reading;

  const readSessionFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    if (file.size > 1024 * 1024) {
      setError(text.apiBalanceFileTooLarge);
      return;
    }
    setReading(true);
    try {
      setSession(await file.text());
      setFileName(file.name);
    } catch (error) {
      setError(String(error));
    } finally {
      setReading(false);
    }
  };

  const query = async () => {
    if (busy || !session.trim()) return;
    setQuerying(true);
    setError(null);
    try {
      await invoke<AccountSummary>("query_openai_balance", {
        id: account.id,
        input: { session, organizationId: organizationId.trim() || null },
      });
      setSession("");
      await onUpdated?.();
      onClose();
    } catch (error) {
      setError(String(error));
    } finally {
      setQuerying(false);
    }
  };

  return (
    <UtilityDialog
      title={`${text.apiBalanceImportSession} · ${account.label}`}
      description={text.apiBalanceSessionHint}
      className="openAiBalanceDialog"
      closeLabel={copy.common.close}
      dismissible={!busy}
      onClose={onClose}
      actions={<>
        <button type="button" className="ghost" disabled={busy} onClick={onClose}>{copy.accountDeleteDialog.cancel}</button>
        <button type="submit" form={id} className="primary" disabled={busy || !session.trim()}>
          {querying ? text.apiBalanceQuerying : text.apiBalanceQuery}
        </button>
      </>}
    >
      <form id={id} onSubmit={(event) => { event.preventDefault(); void query(); }}>
        <label className="addOauthField">
          <span className="addOauthFieldLabel">{text.apiBalanceSessionLabel}</span>
          <SecretInput className="addOauthInput" aria-label={text.apiBalanceSessionLabel} aria-describedby={`${id}-hint`} required disabled={busy}
            placeholder="sess-…" value={session} spellCheck={false}
            onChange={(event) => { setSession(event.target.value); setFileName(""); setError(null); }} />
        </label>
        <div className="openAiBalanceActions">
          <input ref={picker} type="file" accept=".json,.txt,application/json,text/plain" hidden
            disabled={busy} onChange={(event) => void readSessionFile(event)} />
          <button type="button" className="ghost" disabled={busy} onClick={() => picker.current?.click()}>
            {text.apiBalanceChooseFile}
          </button>
          {fileName ? <span className="openAiBalanceFileName">{fileName}</span> : null}
        </div>
        <label className="addOauthField">
          <span className="addOauthFieldLabel">{text.apiBalanceOrganizationLabel}</span>
          <input className="addOauthInput" autoComplete="off" disabled={busy} value={organizationId}
            placeholder="org-…" spellCheck={false} aria-describedby={`${id}-hint`}
            onChange={(event) => { setOrganizationId(event.target.value); setError(null); }} />
        </label>
        <p id={`${id}-hint`} className="pageSectionDescription">{text.apiBalanceOrganizationHint}</p>
        {error ? <p role="alert" className="openAiBalanceError">{error}</p> : null}
      </form>
    </UtilityDialog>
  );
}
