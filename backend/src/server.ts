import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient, TransactionStatus, TransactionType } from '@prisma/client';
import { z } from 'zod';

const app = express();
const prisma = new PrismaClient();
const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

app.use(helmet());
app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

const auth = async (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
};

const sign = (user: any) => jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
const reference = () => `NP-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;

app.get('/health', (_req, res) => res.json({ ok: true, service: 'NaijaPay API' }));

app.post('/api/auth/signup', async (req, res) => {
  const parsed = z.object({ name:z.string().min(2), email:z.string().email(), phone:z.string().regex(/^\+?234\d{10}$/), password:z.string().min(8) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error:'Invalid signup details' });
  const {name,email,phone,password}=parsed.data;
  if (await prisma.user.findFirst({where:{OR:[{email},{phone}]}})) return res.status(409).json({error:'Email or phone already registered'});
  const user=await prisma.user.create({data:{name,email,phone,passwordHash:await bcrypt.hash(password,12),wallet:{create:{balance:0}}},include:{wallet:true}});
  res.status(201).json({ token:sign(user), user:{id:user.id,name:user.name,email:user.email,phone:user.phone,balance:user.wallet?.balance||0} });
});

app.post('/api/auth/login', async (req,res)=>{
  const parsed=z.object({email:z.string().email(),password:z.string()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Invalid login details'});
  const user=await prisma.user.findUnique({where:{email:parsed.data.email},include:{wallet:true}});
  if(!user || !(await bcrypt.compare(parsed.data.password,user.passwordHash)))return res.status(401).json({error:'Invalid credentials'});
  res.json({token:sign(user),user:{id:user.id,name:user.name,email:user.email,phone:user.phone,balance:user.wallet?.balance||0,role:user.role}});
});

app.get('/api/me',auth,async(req:any,res)=>{
  const user=await prisma.user.findUnique({where:{id:req.user.id},include:{wallet:true}});
  if(!user)return res.status(404).json({error:'User not found'});
  res.json({id:user.id,name:user.name,email:user.email,phone:user.phone,balance:user.wallet?.balance||0,role:user.role});
});

app.get('/api/transactions',auth,async(req:any,res)=>{
  const tx=await prisma.transaction.findMany({where:{userId:req.user.id},orderBy:{createdAt:'desc'},take:50});
  res.json(tx);
});

// Funding intent: payment provider should call the webhook below after a verified payment.
app.post('/api/wallet/fund',auth,async(req:any,res)=>{
  const parsed=z.object({amount:z.number().positive().max(5000000)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Invalid amount'});
  const tx=await prisma.transaction.create({data:{userId:req.user.id,type:TransactionType.FUNDING,status:TransactionStatus.PENDING,amount:parsed.data.amount,reference:reference(),description:'Wallet funding'}});
  // Integrate a provider here (e.g. Flutterwave/Paystack) using server-side secret credentials.
  res.status(201).json({reference:tx.reference,status:tx.status,message:'Funding intent created; connect payment provider checkout.'});
});

// Provider webhook placeholder. Verify signature/provider event before crediting funds.
app.post('/api/payments/webhook',async(req,res)=>{
  // TODO: verify provider signature and idempotency, then atomically credit wallet + mark transaction SUCCESS.
  res.json({received:true});
});

app.post('/api/transfers',auth,async(req:any,res)=>{
  const parsed=z.object({bank:z.string().min(2),accountNumber:z.string().regex(/^\d{10}$/),amount:z.number().positive(),description:z.string().max(100).optional()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Invalid transfer details'});
  const {amount}=parsed.data;
  const tx=await prisma.$transaction(async(db)=>{
    const wallet=await db.wallet.findUnique({where:{userId:req.user.id}});
    if(!wallet || Number(wallet.balance)<amount) throw new Error('INSUFFICIENT_FUNDS');
    await db.wallet.update({where:{userId:req.user.id},data:{balance:{decrement:amount}}});
    return db.transaction.create({data:{userId:req.user.id,type:TransactionType.TRANSFER,status:TransactionStatus.PENDING,amount:-amount,reference:reference(),description:parsed.data.description||`Transfer to ${parsed.data.bank}`,metadata:{bank:parsed.data.bank,accountNumber:parsed.data.accountNumber}}});
  }).catch((e)=>e.message==='INSUFFICIENT_FUNDS'?null:Promise.reject(e));
  if(!tx)return res.status(400).json({error:'Insufficient funds'});
  // Production: submit tx to a licensed payout provider and reconcile by webhook.
  res.status(201).json({transaction:tx,message:'Transfer queued for provider processing.'});
});

app.get('/api/admin/summary',auth,async(req:any,res)=>{
  const user=await prisma.user.findUnique({where:{id:req.user.id}});
  if(user?.role!=='ADMIN')return res.status(403).json({error:'Admin access required'});
  const [users,transactions,pending]=await Promise.all([prisma.user.count(),prisma.transaction.count(),prisma.transaction.count({where:{status:TransactionStatus.PENDING}})]);
  res.json({users,transactions,pending});
});

app.use((err:any,_req:any,res:any,_next:any)=>{console.error(err);res.status(500).json({error:'Internal server error'});});
app.listen(PORT,()=>console.log(`NaijaPay API listening on ${PORT}`));
