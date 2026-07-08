// Delivery manifest (§2A/§11): today's delivery orders with box count (distinct
// lines), address, items, total, paid status, plus CSV export/print.

import { useQuery } from "@tanstack/react-query";

import { exportDeliveriesCsv, getDeliveries } from "../api/endpoints";
import { Loading, PageHead } from "../components/ui";

export default function Deliveries() {
  const today = new Date().toISOString().slice(0, 10);
  const q = useQuery({ queryKey: ["deliveries", "today"], queryFn: () => getDeliveries({}) });

  return (
    <div className="page">
      <PageHead title="Deliveries — today">
        <button className="btn neutral" onClick={() => window.print()}>Print</button>
        <button className="btn neutral" onClick={() => void exportDeliveriesCsv(today, today)}>Export CSV</button>
      </PageHead>

      {q.isLoading ? (
        <Loading />
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Needed</th>
                <th>Client</th>
                <th>Address</th>
                <th>Items</th>
                <th className="num">Boxes</th>
                <th className="num">Total</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody>
              {(q.data?.rows ?? []).map((r) => (
                <tr key={r.order_id}>
                  <td>{r.needed_for_date ? new Date(r.needed_for_date).toLocaleDateString() : "—"}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.client_name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{r.client_phone}</div>
                  </td>
                  <td>{r.delivery_address ?? "—"}</td>
                  <td className="muted">{r.items.map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}</td>
                  <td className="num">{r.box_count}</td>
                  <td className="num">${r.total}</td>
                  <td><span className={`pill ${r.paid_status}`}>{r.paid_status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {q.data && q.data.rows.length === 0 && <p className="muted">No deliveries today.</p>}
        </div>
      )}
    </div>
  );
}
