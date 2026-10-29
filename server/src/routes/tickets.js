import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { analyzeTicket } from '../services/copilotService.js';
import { acknowledgeEscalations } from '../services/escalationService.js';
import { draftReply } from '../services/replyAssistantService.js';
import {
  addMessage,
  createTicket,
  deleteTicket,
  getTicketDetail,
  listTickets,
  parseTicketId,
  updateTicket,
} from '../services/ticketService.js';
import { validationError } from '../utils/httpError.js';
import { parseTicketListQuery } from '../validation/listQuery.js';
import { validateCreateTicket, validateMessage, validateTicketPatch } from '../validation/ticketValidation.js';

export const ticketsRouter = Router();

function valid({ value, errors }) {
  if (errors) throw validationError(errors);
  return value;
}

ticketsRouter.get('/', async (req, res) => {
  const filters = valid(parseTicketListQuery(req.query, req.user));
  res.json(await listTickets(filters));
});

ticketsRouter.post('/', async (req, res) => {
  const ticket = await createTicket(valid(validateCreateTicket(req.body)), req.user);
  res.status(201).location(`/api/tickets/${ticket.id}`).json({ data: ticket });
});

ticketsRouter.get('/:id', async (req, res) => {
  res.json({ data: await getTicketDetail(parseTicketId(req.params.id)) });
});

ticketsRouter.patch('/:id', async (req, res) => {
  const id = parseTicketId(req.params.id);
  res.json({ data: await updateTicket(id, valid(validateTicketPatch(req.body)), req.user) });
});

// Deletion policy: admins only; replies, notes and history are removed with the ticket.
ticketsRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  await deleteTicket(parseTicketId(req.params.id), req.user);
  res.status(204).end();
});

ticketsRouter.post('/:id/messages', async (req, res) => {
  const id = parseTicketId(req.params.id);
  const message = await addMessage(id, valid(validateMessage(req.body)), req.user);
  res.status(201).json({ data: message });
});

// AI Support Copilot: read-only recommendation for the agent; the ticket is not changed.
ticketsRouter.post('/:id/analyze', async (req, res) => {
  res.json({ data: await analyzeTicket(parseTicketId(req.params.id), req.user) });
});

// AI Reply Assistant: returns draft text only. Sending stays with POST /:id/messages.
ticketsRouter.post('/:id/draft-reply', async (req, res) => {
  res.json({ data: await draftReply(parseTicketId(req.params.id), req.user) });
});

// Marks the ticket's escalations as seen by the current user. Idempotent; does not change the ticket.
ticketsRouter.post('/:id/escalation/acknowledge', async (req, res) => {
  res.json({ data: await acknowledgeEscalations(parseTicketId(req.params.id), req.user) });
});
