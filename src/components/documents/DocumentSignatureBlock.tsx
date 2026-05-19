export function DocumentSignatureBlock({ staff = false }: { staff?: boolean }) {
  return (
    <div className="document-signatures avoid-break">
      <div>
        <div className="signature-line" />
        <strong>{staff ? 'Staff Signature' : 'Customer / Representative Signature'}</strong>
        <span>Name:</span>
        <span>Date:</span>
      </div>
      <div>
        <div className="signature-line" />
        <strong>{staff ? 'Received By' : 'For Genius Advanced Use Only'}</strong>
        <span>{staff ? 'Technician:' : 'Received By:'}</span>
        <span>Branch:</span>
        <span>Date:</span>
      </div>
    </div>
  );
}
