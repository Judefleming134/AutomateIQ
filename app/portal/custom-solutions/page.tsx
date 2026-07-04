import { Box, MessageSquare } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";

export default async function CustomSolutionsPage() {
  await requireSession();
  const supabase = await createClient();

  // RLS scopes this to the caller's own business automatically.
  const { data: modules } = await supabase
    .from("custom_modules")
    .select("id, name, description, route_slug");

  const hasModules = (modules ?? []).length > 0;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Custom Solutions</h1>
          <p>
            Bespoke AI modules built specifically for your business — quote
            generators, invoicing tools, custom CRMs, and more.
          </p>
        </div>
      </div>

      <div className="steps">
        <div className="panel step">
          <div className="step-num">1</div>
          <h3>Tell us the problem</h3>
          <p>
            Describe the repetitive job eating your week — quoting, invoicing,
            scheduling, chasing paperwork.
          </p>
        </div>
        <div className="panel step">
          <div className="step-num">2</div>
          <h3>We build your module</h3>
          <p>
            A custom AI tool built around exactly how your business works —
            not a generic template.
          </p>
        </div>
        <div className="panel step">
          <div className="step-num">3</div>
          <h3>It appears right here</h3>
          <p>
            Your module shows up on this page and in your sidebar, ready to
            use. No installs, no extra logins.
          </p>
        </div>
      </div>

      <h2 className="section-title">Your modules</h2>
      {hasModules ? (
        <div className="product-grid">
          {(modules ?? []).map((m) => (
            <div
              key={m.id}
              className="panel product-tile"
              style={{ "--tile-accent": "#F472B6" } as React.CSSProperties}
            >
              <div className="product-tile-icon">
                <Box size={21} />
              </div>
              <h3>{m.name}</h3>
              {m.description && <p>{m.description}</p>}
              <span className="badge badge-green">Active</span>
            </div>
          ))}
        </div>
      ) : (
        <div
          className="panel panel-block"
          style={{ textAlign: "center", padding: "36px 24px" }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              display: "grid",
              placeItems: "center",
              background: "rgba(244, 114, 182, 0.14)",
              color: "#F472B6",
              margin: "0 auto 12px",
            }}
          >
            <MessageSquare size={20} />
          </div>
          <h3 style={{ fontSize: 15, marginBottom: 4 }}>
            No custom modules yet
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: "var(--body)" }}>
            Get in touch to discuss what you need — hello@automateiq.ie
          </p>
        </div>
      )}
    </>
  );
}
