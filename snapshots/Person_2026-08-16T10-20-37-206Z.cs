using System;
public class Person
{
    private string Name { get; set; }


    private void ExtractName() {
        Console.WriteLine("Get Name");
    }


    public Person(string name, int age)
    {
        Name = name;
        Age = age;

    }
     

}


