import { useRef, useState, type ChangeEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Camera, Hourglass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDriverStore } from "@/lib/driver-store";
import { submitDriverAvatar } from "@/lib/driver-avatar.functions";

function initials(name?: string | null): string {
  const n = (name ?? "").trim();
  if (!n) return "👤";
  const p = n.split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

export function DriverAvatarUpload() {
  const driver = useDriverStore((s) => s.driver);
  const setDriver = useDriverStore((s) => s.setDriver);
  const session = useDriverStore((s) => s.session);
  const submit = useServerFn(submitDriverAvatar);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!driver) return null;

  const status = driver.avatar_status ?? "none";
  const display =
    status === "approved"
      ? driver.avatar_url
      : status === "pending"
        ? driver.pending_avatar_url
        : null;
  const isPending = status === "pending";

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5 MB");
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  function close() {
    setFile(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
  }

  async function confirmUpload() {
    if (!file || !driver) return;
    setBusy(true);
    try {
      const uid = session?.user?.id ?? driver.user_id ?? "unknown";
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `driver/${uid}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      await submit({ data: { url } });
      setDriver({ ...driver, pending_avatar_url: url, avatar_status: "pending" });
      toast.success("Photo submitted — pending dispatcher approval");
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        title="Change your profile photo"
        className="relative w-20 h-20 mx-auto rounded-full overflow-hidden border border-primary/40 bg-primary/20 flex items-center justify-center mb-3"
      >
        {display ? (
          <img
            src={display}
            alt=""
            className={"w-full h-full object-cover " + (isPending ? "opacity-60" : "")}
          />
        ) : (
          <span className="text-3xl">{initials(driver.name)}</span>
        )}
        <span className="absolute bottom-0 right-0 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground border-2 border-card">
          <Camera className="size-3" />
        </span>
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />

      {status === "pending" && (
        <p className="flex items-center justify-center gap-1 text-[11px] font-medium text-amber-600">
          <Hourglass className="size-3" /> Photo awaiting dispatcher approval
        </p>
      )}
      {status === "rejected" && (
        <p className="text-[11px] font-medium text-destructive">
          Photo not approved — please upload a suitable one.
        </p>
      )}

      {file && (
        <div className="fixed inset-0 z-[3000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-5">
          <div className="bg-card border border-border rounded-2xl p-5 max-w-sm w-full text-center shadow-2xl">
            <div className="w-24 h-24 mx-auto rounded-full overflow-hidden border border-border mb-4">
              {preview && <img src={preview} alt="" className="w-full h-full object-cover" />}
            </div>
            <h3 className="text-base font-bold text-foreground">Use this photo?</h3>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
              Make sure your photo is a clear, appropriate headshot — <strong>no nudity, offensive
              or inappropriate content</strong>. It must be <strong>approved by your dispatcher</strong>{" "}
              before it appears in the system.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={close}
                disabled={busy}
                className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-surface text-sm font-medium active:scale-[0.99] transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmUpload}
                disabled={busy}
                className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold active:scale-[0.99] transition disabled:opacity-50"
              >
                {busy ? "Uploading…" : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
