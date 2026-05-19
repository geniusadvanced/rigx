export function GeniusDocumentFooter({ legal = false }: { legal?: boolean }) {
  return (
    <footer className="document-footer avoid-break">
      <div>This is a computer-generated document.</div>
      <div>Thank you for choosing Genius Advanced.</div>
      {legal ? <div>Subject to Genius Advanced Terms & Conditions.</div> : null}
      <div>Genius Advanced · Laptop Repair | Phone Repair | Data Recovery</div>
    </footer>
  );
}
