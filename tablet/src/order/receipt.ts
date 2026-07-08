// Fetch the server-rendered receipt PDF (authenticated) and hand it to the
// tablet's own print/share sheet (spec §2A / Phase 6). There is no server-side
// printer — Print.printAsync opens the OS dialog (incl. "Save as PDF" and any
// printer the tablet already knows about).

import * as FileSystem from "expo-file-system";
import * as Print from "expo-print";

import { API_URL, getAuthToken } from "../api/client";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onloadend = () => {
      const s = String(reader.result);
      resolve(s.slice(s.indexOf(",") + 1)); // drop the "data:...;base64," prefix
    };
    reader.readAsDataURL(blob);
  });
}

export async function printReceipt(orderId: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/orders/${orderId}/receipt`, {
    headers: { Authorization: `Bearer ${getAuthToken() ?? ""}` },
  });
  if (!res.ok) throw new Error("Could not fetch the receipt.");

  const base64 = await blobToBase64(await res.blob());
  const fileUri = `${FileSystem.cacheDirectory}receipt-${orderId}.pdf`;
  await FileSystem.writeAsStringAsync(fileUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await Print.printAsync({ uri: fileUri });
}
