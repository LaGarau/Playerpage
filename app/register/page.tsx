import RegisterForm from "../../components/RegisterForm";

export default function RegisterPage() {
  return (
   <div className="min-h-screen bg-white flex flex-col items-center">
      <div className="flex items-center justify-center pt-8 pb-4 gap-4">
        
        <img className="w-[400px]" src="/images/letsgetstarted.png" alt="Logo" />
      </div>
      <div className="auth-inner">
        <RegisterForm />
      </div>
    </div>
  );
}
