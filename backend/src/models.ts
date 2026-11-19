import mongoose,{Schema} from 'mongoose';
const UserSchema=new Schema({name:{type:String,required:true,trim:true},email:{type:String,required:true,unique:true,lowercase:true,index:true},passwordHash:{type:String,required:true,select:false},phone:{type:String,required:true},role:{type:String,enum:['participant','admin'],default:'participant'},createdAt:{type:Date,default:Date.now}},{timestamps:true});
const RegistrationSchema=new Schema({
  userId:{type:Schema.Types.ObjectId,ref:'User',required:true,index:true},
  idempotencyKey:{type:String,trim:true,minlength:16,maxlength:128},
  distancePackage:{type:String,enum:['05','10','20'],required:true},
  amountPaise:{type:Number,required:true},
  currency:{type:String,default:'INR',enum:['INR']},
  paymentStatus:{type:String,enum:['pending','paid','failed'],default:'pending'},
  status:{type:String,enum:['pending_payment','confirmed','run_pending','completed'],default:'pending_payment'},
  address:{line1:{type:String,required:true,trim:true},city:{type:String,required:true,trim:true},state:{type:String,required:true,trim:true},pincode:{type:String,required:true,trim:true}},
  createdAt:{type:Date,default:Date.now}
},{timestamps:true});
RegistrationSchema.index({userId:1,idempotencyKey:1},{unique:true,sparse:true});
const PaymentSchema=new Schema({registrationId:{type:Schema.Types.ObjectId,ref:'Registration',required:true,index:true},razorpayOrderId:{type:String,index:true},razorpayPaymentId:{type:String,index:true},amountPaise:{type:Number,required:true},status:{type:String,enum:['created','authorized','captured','failed'],default:'created'},signatureVerified:{type:Boolean,default:false},createdAt:{type:Date,default:Date.now}},{timestamps:true});
const SubmissionSchema=new Schema({registrationId:{type:Schema.Types.ObjectId,ref:'Registration',required:true,index:true},storageKey:{type:String,required:true},originalFilename:String,mimeType:String,status:{type:String,enum:['queued','processing','pending_review','approved','rejected','resubmission_requested'],default:'queued'},extractedDistance:Number,extractedDuration:String,activityDate:Date,createdAt:{type:Date,default:Date.now}},{timestamps:true});
const VerificationSchema=new Schema({submissionId:{type:Schema.Types.ObjectId,ref:'Submission',required:true,index:true},ocrText:String,findings:[String],riskLevel:{type:String,enum:['low','medium','high','unknown'],default:'unknown'},modelNotes:String,processedAt:Date},{timestamps:true});
const AuditSchema=new Schema({adminId:{type:Schema.Types.ObjectId,ref:'User',required:true},submissionId:{type:Schema.Types.ObjectId,ref:'Submission'},action:String,reason:String,createdAt:{type:Date,default:Date.now}});
const KitSchema=new Schema({registrationId:{type:Schema.Types.ObjectId,ref:'Registration',required:true,unique:true},eligibleDistance:String,eligibilityStatus:{type:String,enum:['not_eligible','eligible'],default:'not_eligible'},shippingStatus:{type:String,enum:['not_started','packing','shipped','delivered'],default:'not_started'},trackingNumber:String},{timestamps:true});
export const User=mongoose.model('User',UserSchema);
export const Registration=mongoose.model('Registration',RegistrationSchema);
export const Payment=mongoose.model('Payment',PaymentSchema);
export const Submission=mongoose.model('Submission',SubmissionSchema);
export const Verification=mongoose.model('Verification',VerificationSchema);
export const Audit=mongoose.model('Audit',AuditSchema);
export const KitDispatch=mongoose.model('KitDispatch',KitSchema);
