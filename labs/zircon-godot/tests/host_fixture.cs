// Test doubles for the host lifecycle only. No game, network or MirDB acceptance.
using System;
using System.Reflection;
using System.Threading;

namespace Library
{
    public static class ConfigReader
    {
        public static void Load(Assembly _) { }
        public static void Save(Assembly _) => Console.WriteLine("CONFIG_SAVED");
    }
    public static class Encryption { public static void SetKey(byte[] _) { } }
}
namespace Server.Envir
{
    public static class Config
    {
        public static bool SinglePlayerDev, EncryptionEnabled;
        public static int MaxLevel;
        public static string EncryptionKey = "";
        public static void LoadVersion() { }
    }
    public static class DevSinglePlayer { public const int DevLevel = 1; }
    public static class SEnvir
    {
        public static byte[] CryptoKey;
        public static bool UseLogConsole;
        public static volatile bool Started;
        public static Thread EnvirThread;
        public static void StartServer()
        {
            Started = true;
            EnvirThread = new Thread(() =>
            {
                Thread.Sleep(100); // Allow Main to install its handler.
                Console.WriteLine("READY");
                if (Environment.GetEnvironmentVariable("HOST_SELF_STOP") == "1")
                    Started = false;
                while (Started) Thread.Sleep(5);
                Thread.Sleep(250); // Save must finish before process exit.
                Console.WriteLine("WORLD_SAVED");
                EnvirThread = null;
            }) { IsBackground = true };
            EnvirThread.Start();
        }
    }
}
