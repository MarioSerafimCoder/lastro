export default function Pulso({
  message,
  busy = false,
}: {
  message: string;
  busy?: boolean;
}) {
  return (
    <div className={`pulso ${busy ? "is-busy" : ""}`} role="status">
      <span className="pulso-symbol" key={message} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>{message}</span>
    </div>
  );
}
