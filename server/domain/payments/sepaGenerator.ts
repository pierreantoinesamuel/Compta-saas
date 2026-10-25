export interface SepaTransaction {
  endToEndId: string;
  amount: number; // minor units (cents)
  creditorName: string;
  creditorIban: string;
  creditorBic?: string;
  remittanceInfo: string;
}

export interface SepaPaymentInput {
  batchRef: string;
  executionDate: string; // ISO date YYYY-MM-DD
  debtorName: string;
  debtorIban: string;
  debtorBic?: string;
  transactions: SepaTransaction[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatAmount(minor: number): string {
  return (minor / 100).toFixed(2);
}

function isoDateTime(dateStr: string): string {
  return `${dateStr}T00:00:00`;
}

export function generateSepaPain001(input: SepaPaymentInput): string {
  const { batchRef, executionDate, debtorName, debtorIban, debtorBic, transactions } = input;
  const totalMinor = transactions.reduce((sum, t) => sum + t.amount, 0);
  const totalAmount = formatAmount(totalMinor);
  const creationDateTime = new Date().toISOString().replace(/\.\d{3}Z$/, '');
  const nbTxs = transactions.length;

  const txXml = transactions.map((tx, i) => {
    const bic = tx.creditorBic
      ? `<FinInstnId><BIC>${esc(tx.creditorBic)}</BIC></FinInstnId>`
      : `<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>`;
    return `
    <CdtTrfTxInf>
      <PmtId>
        <EndToEndId>${esc(tx.endToEndId.slice(0, 35))}</EndToEndId>
      </PmtId>
      <Amt>
        <InstdAmt Ccy="EUR">${formatAmount(tx.amount)}</InstdAmt>
      </Amt>
      <CdtrAgt>${bic}</CdtrAgt>
      <Cdtr>
        <Nm>${esc(tx.creditorName.slice(0, 70))}</Nm>
      </Cdtr>
      <CdtrAcct>
        <Id><IBAN>${esc(tx.creditorIban.replace(/\s/g, ''))}</IBAN></Id>
      </CdtrAcct>
      <RmtInf>
        <Ustrd>${esc(tx.remittanceInfo.slice(0, 140))}</Ustrd>
      </RmtInf>
    </CdtTrfTxInf>`;
  }).join('');

  const debtorBicXml = debtorBic
    ? `<DbtrAgt><FinInstnId><BIC>${esc(debtorBic)}</BIC></FinInstnId></DbtrAgt>`
    : `<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03 pain.001.001.03.xsd">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${esc(batchRef.slice(0, 35))}</MsgId>
      <CreDtTm>${creationDateTime}</CreDtTm>
      <NbOfTxs>${nbTxs}</NbOfTxs>
      <CtrlSum>${totalAmount}</CtrlSum>
      <InitgPty>
        <Nm>${esc(debtorName.slice(0, 70))}</Nm>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${esc(batchRef.slice(0, 35))}-PMT</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <NbOfTxs>${nbTxs}</NbOfTxs>
      <CtrlSum>${totalAmount}</CtrlSum>
      <PmtTpInf>
        <SvcLvl><Cd>SEPA</Cd></SvcLvl>
      </PmtTpInf>
      <ReqdExctnDt>${executionDate}</ReqdExctnDt>
      <Dbtr>
        <Nm>${esc(debtorName.slice(0, 70))}</Nm>
      </Dbtr>
      <DbtrAcct>
        <Id><IBAN>${esc(debtorIban.replace(/\s/g, ''))}</IBAN></Id>
        <Ccy>EUR</Ccy>
      </DbtrAcct>
      ${debtorBicXml}${txXml}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>`;
}
