import { useEffect, useState } from 'react';
import {
  invitePartner,
  getPendingInvites,
  getSentInvites,
  acceptInvite,
  declineInvite,
  cancelInvite,
} from '../../services/partnerships';

export default function PartnerSetup({ onPartnershipCreated }) {
  const [email, setEmail] = useState('');
  const [pendingInvites, setPendingInvites] = useState([]);
  const [sentInvites, setSentInvites] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadInvites();
  }, []);

  async function loadInvites() {
    try {
      const [incoming, outgoing] = await Promise.all([
        getPendingInvites(),
        getSentInvites(),
      ]);
      setPendingInvites(incoming);
      setSentInvites(outgoing);
    } catch (err) {
      setError(err?.message || 'Failed to load invites.');
    }
  }

  async function handleInvite(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await invitePartner(email.trim());
      setSuccess(`Invite sent to ${email.trim()}`);
      setEmail('');
      await loadInvites();
    } catch (err) {
      setError(err?.message || 'Failed to send invite.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAccept(id) {
    setLoading(true);
    setError('');
    try {
      await acceptInvite(id);
      onPartnershipCreated();
    } catch (err) {
      setError(err?.message || 'Failed to accept invite.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDecline(id) {
    setLoading(true);
    setError('');
    try {
      await declineInvite(id);
      await loadInvites();
    } catch (err) {
      setError(err?.message || 'Failed to decline invite.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel(id) {
    setLoading(true);
    setError('');
    try {
      await cancelInvite(id);
      await loadInvites();
    } catch (err) {
      setError(err?.message || 'Failed to cancel invite.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Invite form */}
      <div className="rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100 mb-1">
          Invite Your Partner
        </h2>
        <p className="text-sm text-stone-500 dark:text-stone-400 mb-4">
          Enter your partner's email to start splitting expenses together.
        </p>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400">
            {success}
          </div>
        )}

        <form onSubmit={handleInvite} className="flex gap-3">
          <input
            type="email"
            required
            placeholder="partner@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded-xl border border-stone-200 bg-stone-50/50 px-4 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-stone-700 dark:bg-stone-900/50 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-amber-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-500/20 transition-all hover:from-amber-600 hover:to-amber-700 hover:shadow-lg hover:shadow-amber-500/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Sending…' : 'Send Invite'}
          </button>
        </form>
      </div>

      {/* Sent invites */}
      {sentInvites.length > 0 && (
        <div className="rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100 mb-4">
            Sent Invites
          </h2>
          <div className="space-y-3">
            {sentInvites.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center justify-between rounded-xl border border-stone-100 bg-stone-50/50 px-4 py-3 dark:border-stone-700 dark:bg-stone-900/50"
              >
                <div>
                  <p className="text-sm font-medium text-stone-700 dark:text-stone-300">
                    {invite.invited_email}
                  </p>
                  <p className="text-xs text-stone-400 dark:text-stone-500">Pending acceptance</p>
                </div>
                <button
                  onClick={() => handleCancel(invite.id)}
                  disabled={loading}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-300 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Incoming invites */}
      {pendingInvites.length > 0 && (
        <div className="rounded-2xl border border-amber-200/60 bg-amber-50/50 p-6 shadow-md shadow-stone-200/30 dark:border-amber-800/40 dark:bg-amber-950/20 dark:shadow-stone-900/50">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100 mb-4">
            Partnership Invites
          </h2>
          <div className="space-y-3">
            {pendingInvites.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center justify-between rounded-xl border border-amber-100 bg-white px-4 py-3 dark:border-amber-800/40 dark:bg-stone-800"
              >
                <div>
                  <p className="text-sm font-medium text-stone-700 dark:text-stone-300">
                    Partner invite received
                  </p>
                  <p className="text-xs text-stone-400 dark:text-stone-500">
                    {new Date(invite.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDecline(invite.id)}
                    disabled={loading}
                    className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700 disabled:opacity-50"
                  >
                    Decline
                  </button>
                  <button
                    onClick={() => handleAccept(invite.id)}
                    disabled={loading}
                    className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
                  >
                    Accept
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {pendingInvites.length === 0 && sentInvites.length === 0 && (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50/50 p-8 text-center dark:border-stone-700 dark:bg-stone-900/30">
          <svg className="mx-auto h-12 w-12 text-stone-300 dark:text-stone-600" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
          <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">
            No pending invites. Send an invite to get started!
          </p>
        </div>
      )}
    </div>
  );
}
