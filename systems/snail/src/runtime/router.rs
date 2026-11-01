use std::cell::RefCell;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::task::{Context, Poll, Waker};

use ahash::RandomState;
use bytes::Bytes;
use tokio::sync::{mpsc, oneshot};

use crate::command::Command;
use crate::protocol::frame::Reply;

pub type ShardId = usize;
pub type WorkerId = usize;

#[derive(Debug)]
pub enum CtrlRequest {
    Shutdown,
    Info,
    DbSize,
    Flush,
}

#[derive(Debug)]
pub struct ShardRequest {
    pub shard_id: ShardId,
    pub cmd: Command,
    pub reply: ReplyId,
    /// Worker that owns the local reply slot.
    pub origin_worker: WorkerId,
}

#[derive(Clone)]
pub struct ShardMap {
    num_shards: usize,
    num_workers: usize,
    hasher: RandomState,
}

impl ShardMap {
    pub fn new(num_shards: usize, num_workers: usize, seed: u64) -> Self {
        let hasher = RandomState::with_seeds(
            seed,
            seed.wrapping_mul(0x9E37_79B9_7F4A_7C15),
            seed.wrapping_mul(0xBF58_476D_1CE4_E5B9),
            seed.wrapping_mul(0x94D0_49BB_1331_11EB),
        );
        Self {
            num_shards,
            num_workers,
            hasher,
        }
    }

    pub fn shard_of(&self, key: &Bytes) -> ShardId {
        use std::hash::{BuildHasher, Hash, Hasher};
        let mut h = self.hasher.build_hasher();
        key.hash(&mut h);
        (h.finish() as usize) % self.num_shards
    }

    pub fn owner_of(&self, shard_id: ShardId) -> WorkerId {
        let shards_per_worker = self.num_shards / self.num_workers;
        shard_id / shards_per_worker
    }

    pub fn local_shard_index(&self, worker_id: WorkerId) -> ShardId {
        let shards_per_worker = self.num_shards / self.num_workers;
        worker_id * shards_per_worker
    }

    pub fn shards_for_worker(&self, worker_id: WorkerId) -> std::ops::Range<ShardId> {
        let shards_per_worker = self.num_shards / self.num_workers;
        let start = worker_id * shards_per_worker;
        start..start + shards_per_worker
    }

    pub fn num_shards(&self) -> usize {
        self.num_shards
    }

    pub fn num_workers(&self) -> usize {
        self.num_workers
    }
}

/// Cross-reactor wake (mio::Waker, eventfd write, …). Set once per worker.
pub type ReactorWake = Arc<dyn Fn() + Send + Sync>;

/// A transport message never owns a per-command channel or connection token.
#[derive(Debug)]
pub enum ShardBatch {
    Requests(Vec<ShardRequest>),
    Replies(Vec<(ReplyId, Reply)>),
    Closed(WorkerId),
}

pub const BATCH_CAP: usize = 256;
pub const INBOX_BATCH_BUDGET: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReplyId {
    index: usize,
    generation: u64,
}

struct ReplyEntry {
    generation: u64,
    worker: usize,
    occupied: bool,
    result: Option<Result<Reply, ReplyClosed>>,
    waker: Option<Waker>,
}

#[derive(Default)]
struct ReplySlab {
    entries: Vec<ReplyEntry>,
    free: Vec<usize>,
}

impl ReplySlab {
    fn allocate(&mut self, worker: usize) -> ReplyId {
        let index = self.free.pop().unwrap_or_else(|| {
            self.entries.push(ReplyEntry {
                generation: 0,
                worker,
                occupied: false,
                result: None,
                waker: None,
            });
            self.entries.len() - 1
        });
        let slot = &mut self.entries[index];
        slot.worker = worker;
        slot.occupied = true;
        ReplyId {
            index,
            generation: slot.generation,
        }
    }

    fn release(&mut self, id: ReplyId) {
        let slot = &mut self.entries[id.index];
        if slot.occupied && slot.generation == id.generation {
            slot.occupied = false;
            slot.result = None;
            slot.waker = None;
            // Retire the slot on generation overflow rather than permit ABA.
            if let Some(next) = slot.generation.checked_add(1) {
                slot.generation = next;
                self.free.push(id.index);
            }
        }
    }

    fn complete(&mut self, id: ReplyId, result: Result<Reply, ReplyClosed>) {
        if let Some(slot) = self.entries.get_mut(id.index) {
            if slot.occupied && slot.generation == id.generation && slot.result.is_none() {
                slot.result = Some(result);
                if let Some(waker) = slot.waker.take() {
                    waker.wake();
                }
            }
        }
    }
}

#[derive(Debug)]
pub struct ReplyClosed;

pub struct LocalReply {
    slots: Rc<RefCell<ReplySlab>>,
    id: Option<ReplyId>,
}

impl LocalReply {
    fn try_recv(&mut self) -> Result<Reply, oneshot::error::TryRecvError> {
        let Some(id) = self.id else {
            return Err(oneshot::error::TryRecvError::Closed);
        };
        let mut slots = self.slots.borrow_mut();
        let Some(result) = slots.entries[id.index].result.take() else {
            return Err(oneshot::error::TryRecvError::Empty);
        };
        slots.release(id);
        self.id = None;
        result.map_err(|_| oneshot::error::TryRecvError::Closed)
    }
}

impl Drop for LocalReply {
    fn drop(&mut self) {
        if let Some(id) = self.id {
            self.slots.borrow_mut().release(id);
        }
    }
}

/// The oneshot variant is only for a local multi-command task's final result.
pub enum ReplyReceiver {
    Remote(LocalReply),
    Local(oneshot::Receiver<Reply>),
}

impl ReplyReceiver {
    pub fn try_recv(&mut self) -> Result<Reply, oneshot::error::TryRecvError> {
        match self {
            Self::Remote(rx) => rx.try_recv(),
            Self::Local(rx) => rx.try_recv(),
        }
    }
}

impl Future for ReplyReceiver {
    type Output = Result<Reply, ReplyClosed>;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        match self.get_mut() {
            Self::Local(rx) => Pin::new(rx).poll(cx).map(|r| r.map_err(|_| ReplyClosed)),
            Self::Remote(rx) => match rx.try_recv() {
                Ok(reply) => Poll::Ready(Ok(reply)),
                Err(oneshot::error::TryRecvError::Closed) => Poll::Ready(Err(ReplyClosed)),
                Err(oneshot::error::TryRecvError::Empty) => {
                    let id = rx.id.expect("pending reply slot");
                    rx.slots.borrow_mut().entries[id.index].waker = Some(cx.waker().clone());
                    Poll::Pending
                }
            },
        }
    }
}

/// Send + Sync bootstrap state. Local batching state is constructed on the worker.
#[derive(Clone)]
pub struct ShardTransport {
    senders: Arc<Vec<mpsc::UnboundedSender<ShardBatch>>>,
    shard_map: Arc<ShardMap>,
    wakers: Arc<Vec<OnceLock<ReactorWake>>>,
    wake_pending: Arc<Vec<AtomicBool>>,
}

impl ShardTransport {
    pub fn new(
        senders: Arc<Vec<mpsc::UnboundedSender<ShardBatch>>>,
        shard_map: Arc<ShardMap>,
    ) -> Self {
        let n = senders.len();
        Self {
            senders,
            shard_map,
            wakers: Arc::new((0..n).map(|_| OnceLock::new()).collect()),
            wake_pending: Arc::new((0..n).map(|_| AtomicBool::new(false)).collect()),
        }
    }

    pub fn worker_exited(&self, exited: WorkerId) {
        // Ordered after this worker's replies, so peers cannot fail a reply that
        // was already sent. Also progresses when a peer's inbox stays busy.
        for worker in 0..self.senders.len() {
            if self.senders[worker]
                .send(ShardBatch::Closed(exited))
                .is_ok()
                && !self.wake_pending[worker].swap(true, Ordering::AcqRel)
            {
                if let Some(waker) = self.wakers[worker].get() {
                    waker();
                }
            }
        }
    }

    /// A shutdown broadcast must also interrupt reactors blocked on kernel I/O.
    pub fn wake_all(&self) {
        for waker in self.wakers.iter().filter_map(OnceLock::get) {
            waker();
        }
    }

    pub fn local(&self, worker_id: usize) -> ShardClient {
        let n = self.senders.len();
        ShardClient {
            transport: self.clone(),
            worker_id,
            state: Rc::new(RefCell::new(BatchState {
                requests: (0..n).map(|_| Vec::new()).collect(),
                replies: (0..n).map(|_| Vec::new()).collect(),
                closed: vec![false; n],
            })),
            slots: Rc::new(RefCell::new(ReplySlab::default())),
        }
    }
}

struct BatchState {
    requests: Vec<Vec<ShardRequest>>,
    replies: Vec<Vec<(ReplyId, Reply)>>,
    closed: Vec<bool>,
}

/// All connections and local helper tasks on one worker share these buffers.
#[derive(Clone)]
pub struct ShardClient {
    transport: ShardTransport,
    worker_id: usize,
    state: Rc<RefCell<BatchState>>,
    slots: Rc<RefCell<ReplySlab>>,
}

impl ShardClient {
    pub fn register_waker(&self, worker: usize, waker: ReactorWake) {
        let _ = self.transport.wakers[worker].set(waker);
        // Cover messages queued before the reactor registered its wake hook.
        if self.transport.wake_pending[worker].load(Ordering::Acquire) {
            if let Some(w) = self.transport.wakers[worker].get() {
                w();
            }
        }
    }

    pub fn clear_wake(&self, worker: usize) {
        self.transport.wake_pending[worker].store(false, Ordering::Release);
    }

    pub fn wake(&self, worker: usize) {
        if !self.transport.wake_pending[worker].swap(true, Ordering::AcqRel) {
            if let Some(w) = self.transport.wakers[worker].get() {
                w();
            }
        }
    }

    pub fn send_to(
        &self,
        shard_id: ShardId,
        cmd: Command,
        origin_worker: WorkerId,
    ) -> ReplyReceiver {
        debug_assert_eq!(origin_worker, self.worker_id);
        let worker = self.transport.shard_map.owner_of(shard_id);
        let id = self.slots.borrow_mut().allocate(worker);
        let mut state = self.state.borrow_mut();
        if state.closed[worker] || self.transport.senders[worker].is_closed() {
            self.slots.borrow_mut().complete(id, Err(ReplyClosed));
        } else {
            state.requests[worker].push(ShardRequest {
                shard_id,
                cmd,
                reply: id,
                origin_worker,
            });
            if state.requests[worker].len() == BATCH_CAP {
                self.send_requests(worker, &mut state);
            }
        }
        ReplyReceiver::Remote(LocalReply {
            slots: self.slots.clone(),
            id: Some(id),
        })
    }

    fn send_requests(&self, worker: usize, state: &mut BatchState) {
        let batch = std::mem::take(&mut state.requests[worker]);
        if batch.is_empty() {
            return;
        }
        match self.transport.senders[worker].send(ShardBatch::Requests(batch)) {
            Ok(()) => self.wake(worker),
            Err(err) => {
                if let ShardBatch::Requests(requests) = err.0 {
                    let mut slots = self.slots.borrow_mut();
                    for req in requests {
                        slots.complete(req.reply, Err(ReplyClosed));
                    }
                }
            }
        }
    }

    pub fn reply(&self, worker: usize, id: ReplyId, reply: Reply) {
        let mut state = self.state.borrow_mut();
        state.replies[worker].push((id, reply));
        if state.replies[worker].len() == BATCH_CAP {
            self.send_replies(worker, &mut state);
        }
    }

    fn send_replies(&self, worker: usize, state: &mut BatchState) {
        let batch = std::mem::take(&mut state.replies[worker]);
        if !batch.is_empty()
            && self.transport.senders[worker]
                .send(ShardBatch::Replies(batch))
                .is_ok()
        {
            self.wake(worker);
        }
    }

    /// Called each reactor turn and before blocking, including after LocalSet yields.
    pub fn flush(&self) {
        let mut state = self.state.borrow_mut();
        for worker in 0..self.transport.senders.len() {
            self.send_requests(worker, &mut state);
            self.send_replies(worker, &mut state);
        }
    }

    fn fail_worker(&self, worker: WorkerId) {
        self.state.borrow_mut().closed[worker] = true;
        let mut slots = self.slots.borrow_mut();
        for slot in &mut slots.entries {
            if slot.occupied && slot.worker == worker && slot.result.is_none() {
                slot.result = Some(Err(ReplyClosed));
                if let Some(waker) = slot.waker.take() {
                    waker.wake();
                }
            }
        }
    }

    /// Clear before draining: a concurrent producer can always arm a fresh wake.
    /// Each message is capped at BATCH_CAP, so socket work cannot be starved.
    pub fn drain(
        &self,
        rx: &mut mpsc::UnboundedReceiver<ShardBatch>,
        mut apply: impl FnMut(ShardRequest) -> Reply,
    ) {
        self.clear_wake(self.worker_id);
        for _ in 0..INBOX_BATCH_BUDGET {
            match rx.try_recv() {
                Ok(ShardBatch::Requests(batch)) => {
                    for request in batch {
                        let origin = request.origin_worker;
                        let id = request.reply;
                        let result = apply(request);
                        self.reply(origin, id, result);
                    }
                }
                Ok(ShardBatch::Replies(batch)) => {
                    let mut slots = self.slots.borrow_mut();
                    for (id, reply) in batch {
                        slots.complete(id, Ok(reply));
                    }
                }
                Ok(ShardBatch::Closed(worker)) => self.fail_worker(worker),
                Err(_) => {
                    self.flush();
                    return;
                }
            }
        }
        // The budget may leave queued work: explicitly rearm even if no producer sends again.
        self.wake(self.worker_id);
        self.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn send_to_buffers_until_reactor_flush() {
        let (tx0, _rx0) = mpsc::unbounded_channel();
        let (tx1, mut rx1) = mpsc::unbounded_channel();
        let map = Arc::new(ShardMap::new(2, 2, 1));
        let client = ShardTransport::new(Arc::new(vec![tx0, tx1]), map).local(0);
        let _first = client.send_to(1, Command::Get(Bytes::from_static(b"key")), 0);
        let _second = client.send_to(1, Command::Get(Bytes::from_static(b"key")), 0);
        assert!(
            matches!(rx1.try_recv(), Err(mpsc::error::TryRecvError::Empty)),
            "requests must stay in the origin batch until reactor flush"
        );
    }

    fn pair() -> (
        ShardClient,
        ShardClient,
        mpsc::UnboundedReceiver<ShardBatch>,
        mpsc::UnboundedReceiver<ShardBatch>,
    ) {
        let (tx0, rx0) = mpsc::unbounded_channel();
        let (tx1, rx1) = mpsc::unbounded_channel();
        let transport =
            ShardTransport::new(Arc::new(vec![tx0, tx1]), Arc::new(ShardMap::new(2, 2, 1)));
        (transport.local(0), transport.local(1), rx0, rx1)
    }

    fn get(client: &ShardClient) -> ReplyReceiver {
        client.send_to(1, Command::Get(Bytes::from_static(b"key")), 0)
    }

    #[test]
    fn flush_groups_requests_and_replies_and_preserves_order() {
        let (origin, owner, mut rx0, mut rx1) = pair();
        let mut first = get(&origin);
        let mut second = get(&origin.clone());
        origin.flush();
        let ShardBatch::Requests(batch) = rx1.try_recv().unwrap() else {
            panic!("request batch");
        };
        assert_eq!(batch.len(), 2);
        assert!(rx1.try_recv().is_err());
        for (n, req) in batch.into_iter().enumerate() {
            owner.reply(req.origin_worker, req.reply, Reply::Int(n as i64));
        }
        assert!(rx0.try_recv().is_err());
        owner.flush();
        let ShardBatch::Replies(batch) = rx0.try_recv().unwrap() else {
            panic!("reply batch");
        };
        assert_eq!(batch.len(), 2);
        for (id, reply) in batch {
            origin.slots.borrow_mut().complete(id, Ok(reply));
        }
        assert!(matches!(first.try_recv(), Ok(Reply::Int(0))));
        assert!(matches!(second.try_recv(), Ok(Reply::Int(1))));
    }

    #[test]
    fn dropped_receiver_does_not_cancel_write_or_deliver_to_reused_slot() {
        let (origin, owner, mut rx0, mut rx1) = pair();
        let abandoned = origin.send_to(
            1,
            Command::Set(
                Bytes::from_static(b"key"),
                Bytes::from_static(b"value"),
                Default::default(),
            ),
            0,
        );
        let old_id = match &abandoned {
            ReplyReceiver::Remote(rx) => rx.id.unwrap(),
            _ => unreachable!(),
        };
        drop(abandoned);
        let mut replacement = get(&origin);
        let new_id = match &replacement {
            ReplyReceiver::Remote(rx) => rx.id.unwrap(),
            _ => unreachable!(),
        };
        assert_eq!(old_id.index, new_id.index);
        assert_ne!(old_id.generation, new_id.generation);
        origin.flush();
        let mut applied = 0;
        owner.drain(&mut rx1, |_| {
            applied += 1;
            Reply::Int(applied)
        });
        assert_eq!(
            applied, 2,
            "disconnect must not cancel already accepted commands"
        );
        origin.drain(&mut rx0, |_| unreachable!());
        assert!(matches!(replacement.try_recv(), Ok(Reply::Int(2))));
    }

    #[test]
    fn closed_owner_completes_buffered_and_inflight_waiters() {
        let (origin, owner, mut rx0, mut rx1) = pair();
        let mut inflight = get(&origin);
        origin.flush();
        let _accepted = rx1.try_recv().unwrap();
        let mut buffered = get(&origin);
        drop(rx1);
        owner.transport.worker_exited(1);
        origin.flush();
        origin.drain(&mut rx0, |_| unreachable!());
        assert!(matches!(
            inflight.try_recv(),
            Err(oneshot::error::TryRecvError::Closed)
        ));
        assert!(matches!(
            buffered.try_recv(),
            Err(oneshot::error::TryRecvError::Closed)
        ));
        assert!(matches!(
            get(&origin).try_recv(),
            Err(oneshot::error::TryRecvError::Closed)
        ));
    }

    #[test]
    fn inbox_budget_rearms_without_dropping_overload() {
        let (origin, owner, mut rx0, mut rx1) = pair();
        let count = BATCH_CAP * INBOX_BATCH_BUDGET + 1;
        let mut pending: Vec<_> = (0..count).map(|_| get(&origin)).collect();
        origin.flush();
        let mut applied = 0;
        owner.drain(&mut rx1, |_| {
            applied += 1;
            Reply::Ok
        });
        assert_eq!(applied, BATCH_CAP * INBOX_BATCH_BUDGET);
        assert!(owner.transport.wake_pending[1].load(Ordering::Acquire));
        owner.drain(&mut rx1, |_| {
            applied += 1;
            Reply::Ok
        });
        assert_eq!(applied, count);
        origin.drain(&mut rx0, |_| unreachable!());
        origin.drain(&mut rx0, |_| unreachable!());
        assert!(pending
            .iter_mut()
            .all(|rx| matches!(rx.try_recv(), Ok(Reply::Ok))));
    }

    #[test]
    fn future_wakes_when_batched_reply_arrives() {
        use std::sync::atomic::AtomicUsize;
        struct CountWake(AtomicUsize);
        impl std::task::Wake for CountWake {
            fn wake(self: Arc<Self>) {
                self.0.fetch_add(1, Ordering::Relaxed);
            }
        }
        let (origin, owner, mut rx0, mut rx1) = pair();
        let mut pending = get(&origin);
        let count = Arc::new(CountWake(AtomicUsize::new(0)));
        let waker = Waker::from(count.clone());
        let mut cx = Context::from_waker(&waker);
        assert!(Pin::new(&mut pending).poll(&mut cx).is_pending());
        origin.flush();
        owner.drain(&mut rx1, |_| Reply::Ok);
        origin.drain(&mut rx0, |_| unreachable!());
        assert_eq!(count.0.load(Ordering::Relaxed), 1);
        assert!(matches!(
            Pin::new(&mut pending).poll(&mut cx),
            Poll::Ready(Ok(Reply::Ok))
        ));
    }

    #[test]
    fn reply_queued_before_owner_exit_wins_over_closed_error() {
        let (origin, owner, mut rx0, mut rx1) = pair();
        let mut pending = get(&origin);
        origin.flush();
        owner.drain(&mut rx1, |_| Reply::Ok);
        drop(rx1);
        owner.transport.worker_exited(1);
        origin.flush();
        origin.drain(&mut rx0, |_| unreachable!());
        assert!(matches!(pending.try_recv(), Ok(Reply::Ok)));
    }

    #[test]
    fn transport_can_cross_worker_threads() {
        fn require_send_sync<T: Send + Sync>() {}
        require_send_sync::<ShardTransport>();
    }
}
