# Resolved launch incident: delayed Funnel DNS publication

Recorded 19 September 2026. No report was submitted to Tailscale.

## Resolution

By 16:14 UTC, all four authoritative nameservers consistently returned three
public IPv4 ingress addresses. Normal hostname resolution and verified HTTPS
then worked, and all 21 API acceptance checks passed without DNS overrides.
The observation window was approximately 24 minutes after initial Funnel
activation. A reconnect and one re-registration were attempted during that
window; the observations do not establish which action, if any, caused recovery.
The diagnostic evidence below is retained for future operations.

## Symptom

The new hostname `offtargetpred-web.tail58d78e.ts.net` remained absent from public
A and AAAA answers while the authenticated node, Funnel, certificate and backend
were healthy. Normal clients received a name-resolution failure. The hostname
served the correct application's HTTP 200 response through a public Funnel
ingress address with full TLS hostname/certificate verification.

## Environment

- Ubuntu 24.04, Tailscale 1.102.4, official signed Ubuntu package.
- Dedicated new node, joined an existing tailnet on 19 September 2026 at
  approximately 15:49 UTC. The existing tailnet already has a working Funnel.
- Backend state: `Running`; online: true; health: empty.
- Node capabilities include `funnel`, `https` and Funnel ports 443/8443/10000.
- Funnel first enabled at 15:49:57 UTC. Certificate obtained at 15:50:34 UTC.
- Mode: background TLS-terminated TCP on 443, PROXY-v2, forwarding to
  `127.0.0.1:8082` (Nginx and the application API).

```json
{
  "TCP": {
    "443": {
      "TCPForward": "127.0.0.1:8082",
      "TerminateTLS": "offtargetpred-web.tail58d78e.ts.net",
      "ProxyProtocol": 2
    }
  },
  "AllowFunnel": {"offtargetpred-web.tail58d78e.ts.net:443": true}
}
```

## Observations and reproduction

On 19 September, from 15:50 through at least 16:09 UTC:

1. The normal host resolver could not resolve the hostname.
2. Google/Cloudflare recursive queries and Cloudflare DNS-over-HTTPS returned
   no address records. Direct `ns1.dnsimple.com` queries also returned no address.
3. Authoritative responses were `NOERROR`/NODATA, with the authoritative-answer
   flag and the `ts.net` SOA (negative TTL 300 seconds). Both TCP and UDP, and
   queries with EDNS cookies disabled, reproduced the missing A record.
4. HTTPS over public ingress `185.40.234.210` returns HTTP 200 and the expected
   application health. No certificate-validation bypass is used.
5. Twenty-one actual API checks passed over the public relay. A fresh Chromium
   instance using a host resolver override passed pair scoring, all three GPU
   models, downloads, deletion, refresh recovery, mobile layout and a real human
   genome search. These are diagnostic checks, not evidence of working normal
   DNS or unrestricted end-user availability.

Read-only reproduction:

```bash
dig @ns1.dnsimple.com offtargetpred-web.tail58d78e.ts.net A \
  +norecurse +nocookie +time=3 +tries=1
dig @ns1.dnsimple.com offtargetpred-web.tail58d78e.ts.net A \
  +tcp +norecurse +nocookie +time=3 +tries=1
dig @1.1.1.1 offtargetpred-web.tail58d78e.ts.net AAAA +time=3 +tries=1
curl --fail --resolve offtargetpred-web.tail58d78e.ts.net:443:185.40.234.210 \
  https://offtargetpred-web.tail58d78e.ts.net/api/v1/health
```

## Bounded recovery attempts

- Restarted `tailscaled`; authentication, Funnel and valid HTTPS recovered.
- Around 16:03 UTC, ran `tailscale down` then `tailscale up` with the original
  hostname/operator/DNS preferences. Verified the node identity was unchanged
  and Funnel was restored. The authoritative A record remained absent.
- Around 16:06 UTC, disabled this node's sole 443 Funnel mapping for five
  seconds and restored the same mapping. Public relay HTTPS remained healthy;
  ordinary hostname resolution remained unavailable.

No other tailnet device or existing Funnel was changed. No authentication keys,
private node identity, user submissions or access tokens are included here.

Related upstream reports:
[missing Funnel DNS record](https://github.com/tailscale/tailscale/issues/7103),
[authoritative/public DNS inconsistency](https://github.com/tailscale/tailscale/issues/20892).
The observations suggest a publication problem; they do not establish that
these reports have the same root cause.

## If this recurs

Compare normal DNS, all authoritative nameservers and certificate-verified
ingress requests before changing application settings. Preserve a bounded
diagnostic record. A maintainer investigation may be needed if authoritative
publication remains inconsistent; avoid repeatedly resetting healthy mappings.
