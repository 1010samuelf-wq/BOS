// Bookkeeping: accounts payable/receivable per company. A "payable" company is
// a supplier we owe (balance shown red); a "receivable" company is a party
// that owes us (balance shown green). Balance is always computed server-side
// from the company's charge/payment entries — never edited directly here.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiRequestError } from "../api/client";
import { createCompany, listCompanies } from "../api/endpoints";
import type { Company, CompanyType } from "../api/types";
import { LoadFailed, Loading, PageHead, isStalled } from "../components/ui";

export default function Bookkeeping() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<CompanyType>("payable");

  const companies = useQuery({ queryKey: ["bookkeeping-companies"], queryFn: () => listCompanies() });
  const create = useMutation({
    mutationFn: () => createCompany({ name: name.trim(), type }),
    onSuccess: () => {
      setName("");
      client.invalidateQueries({ queryKey: ["bookkeeping-companies"] });
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "Could not add company."),
  });

  const payable = (companies.data ?? []).filter((c) => c.type === "payable");
  const receivable = (companies.data ?? []).filter((c) => c.type === "receivable");

  return (
    <div className="page">
      <PageHead title="Bookkeeping" />

      <div className="card">
        <h2>Add company</h2>
        {error && <p className="error">{error}</p>}
        <div className="row" style={{ flexWrap: "wrap" }}>
          <input className="input" placeholder="Company name" value={name}
            onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <div className="tabs">
            <button className={`tab${type === "payable" ? " active" : ""}`} onClick={() => setType("payable")}>
              We owe them
            </button>
            <button className={`tab${type === "receivable" ? " active" : ""}`} onClick={() => setType("receivable")}>
              They owe us
            </button>
          </div>
          <button className="btn primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            Add
          </button>
        </div>
      </div>

      {companies.isLoading ? (
        <Loading />
      ) : isStalled(companies) ? (
        <LoadFailed what="the ledger" onRetry={() => void companies.refetch()} />
      ) : (
        <>
          <CompanyGroup title="We owe" tone="tone-neg" companies={payable} onOpen={(id) => navigate(`/bookkeeping/${id}`)} />
          <CompanyGroup title="Owed to us" tone="tone-ok" companies={receivable} onOpen={(id) => navigate(`/bookkeeping/${id}`)} />
        </>
      )}
    </div>
  );
}

function CompanyGroup({
  title, tone, companies, onOpen,
}: {
  title: string;
  tone: "tone-neg" | "tone-ok";
  companies: Company[];
  onOpen: (id: number) => void;
}) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {companies.length === 0 ? (
        <p className="muted">No companies here yet.</p>
      ) : (
        companies.map((c) => (
          <button
            key={c.id}
            className="order-card"
            style={{ marginBottom: 8 }}
            onClick={() => onOpen(c.id)}
          >
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{c.name}</strong>
              <span className={tone} style={{ fontWeight: 800 }}>${c.balance}</span>
            </div>
          </button>
        ))
      )}
    </div>
  );
}
